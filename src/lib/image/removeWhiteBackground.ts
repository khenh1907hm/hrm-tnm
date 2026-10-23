export type ImagePixels = { data: Uint8ClampedArray; width: number; height: number };

/**
 * Tách nền giấy khỏi ảnh chụp chữ ký / con dấu: san phẳng ánh sáng (bóng tay, giấy ngả vàng, chỗ sáng chỗ tối)
 * rồi giữ lại mọi nét mực có màu — mực đen, mực xanh và mộc đỏ — trên nền trong suốt.
 */
export function removeWhiteBackground(imageData: ImagePixels, options: { force?: boolean } = {}): ImagePixels {
  const { width, height } = imageData;
  const data = new Uint8ClampedArray(imageData.data);
  if (hasTransparency(data)) {
    // Ảnh đã tách nền sẵn (vd từ AI) giữ nguyên, không làm đục lại
    if (!options.force) return { data, width, height };
    // Tách lại theo yêu cầu (nút "Xóa nền"): đặt ảnh lên giấy trắng rồi tách như ảnh chụp, bỏ hết nền mờ còn sót
    flattenOnWhite(data);
  }
  const background = estimateBackground(data, width, height);

  // Độ đậm của từng điểm so với nền giấy tại chỗ đó: 0 = giấy, 1 = mực đậm nhất. Lấy kênh tối nhất để mộc đỏ, mực xanh vẫn được tính là đậm.
  const darkness = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = y * width + x;
      const [backgroundRed, backgroundGreen, backgroundBlue] = background.at(x, y);
      const index = pixel * 4;
      darkness[pixel] = 1 - Math.min(ratio(data[index] ?? 0, backgroundRed), ratio(data[index + 1] ?? 0, backgroundGreen), ratio(data[index + 2] ?? 0, backgroundBlue));
    }
  }

  // Ngưỡng tự chọn theo độ nhiễu của giấy trong chính ảnh này; giữa low và high thì mờ dần cho nét mượt
  const low = Math.min(0.3, Math.max(0.08, percentile(darkness, 0.5) + 5 * (percentile(darkness, 0.75) - percentile(darkness, 0.5)) + 0.03));
  const high = low + 0.15;
  // Nét mực nhạt (mộc in nhạt, bút gần hết mực) được đậm lên bằng nét mực thường gặp trong ảnh, vẫn giữ đúng màu
  const inkDarkness = percentile(darkness.filter((value) => value >= high), 0.75) || 0.8;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = y * width + x;
      const index = pixel * 4;
      const strength = darkness[pixel] ?? 0;
      const alpha = Math.round(Math.min(1, Math.max(0, (strength - low) / (high - low))) * 255);
      data[index + 3] = Math.min(data[index + 3] ?? 255, alpha);
      if (alpha === 0) continue;
      // Màu mực thật sau khi bỏ ánh sáng và phần giấy lẫn vào mép nét
      const boost = Math.max(strength, inkDarkness) / strength;
      background.at(x, y).forEach((channel, offset) => {
        data[index + offset] = Math.round(255 * (1 - (1 - ratio(data[index + offset] ?? 0, channel)) * boost));
      });
    }
  }
  clearBorderRegions(data, width, height);
  return { data, width, height };
}

/** Vùng tối dính liền mép ảnh là mặt bàn, mép tờ giấy, bóng ngoài khung chứ không phải mực: bỏ đi. Vì vậy chụp cần chừa lề quanh chữ ký, mộc. */
function clearBorderRegions(data: Uint8ClampedArray, width: number, height: number) {
  const stack: number[] = [];
  const visit = (pixel: number) => {
    if ((data[pixel * 4 + 3] ?? 0) === 0) return;
    data[pixel * 4 + 3] = 0;
    stack.push(pixel);
  };
  for (let x = 0; x < width; x++) { visit(x); visit((height - 1) * width + x); }
  for (let y = 0; y < height; y++) { visit(y * width); visit(y * width + width - 1); }
  while (stack.length > 0) {
    const pixel = stack.pop()!;
    const x = pixel % width;
    if (x > 0) visit(pixel - 1);
    if (x < width - 1) visit(pixel + 1);
    if (pixel >= width) visit(pixel - width);
    if (pixel < width * (height - 1)) visit(pixel + width);
  }
}

function flattenOnWhite(data: Uint8ClampedArray) {
  for (let index = 0; index < data.length; index += 4) {
    const alpha = (data[index + 3] ?? 255) / 255;
    for (let channel = 0; channel < 3; channel++) data[index + channel] = Math.round((data[index + channel] ?? 0) * alpha + 255 * (1 - alpha));
    data[index + 3] = 255;
  }
}

function hasTransparency(data: Uint8ClampedArray): boolean {
  let transparent = 0;
  for (let index = 3; index < data.length; index += 4) if ((data[index] ?? 255) < 250) transparent++;
  return transparent > data.length / 4 / 100;
}

function ratio(value: number, background: number): number {
  return Math.min(1, value / Math.max(background, 1));
}

/**
 * Màu giấy tại từng chỗ: chia ảnh thành ô, mỗi ô lấy trung bình 20% điểm sáng nhất, lấy ô sáng nhất trong lân cận
 * (để ô dày mực như lòng con dấu không bị coi là giấy), làm mượt rồi nội suy về từng điểm ảnh.
 */
function estimateBackground(data: Uint8ClampedArray, width: number, height: number) {
  const block = Math.min(64, Math.max(4, Math.round(Math.max(width, height) / 32)));
  const columns = Math.ceil(width / block);
  const rows = Math.ceil(height / block);
  const cells = new Float32Array(columns * rows * 3);
  const histogram = new Uint32Array(766);
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      histogram.fill(0);
      const left = column * block, top = row * block;
      const right = Math.min(width, left + block), bottom = Math.min(height, top + block);
      for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
        const index = (y * width + x) * 4;
        histogram[(data[index] ?? 0) + (data[index + 1] ?? 0) + (data[index + 2] ?? 0)]!++;
      }
      let threshold = 765;
      for (let wanted = Math.max(1, Math.round((right - left) * (bottom - top) * 0.2)), seen = 0; threshold > 0; threshold--) {
        seen += histogram[threshold] ?? 0;
        if (seen >= wanted) break;
      }
      let red = 0, green = 0, blue = 0, count = 0;
      for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
        const index = (y * width + x) * 4;
        if ((data[index] ?? 0) + (data[index + 1] ?? 0) + (data[index + 2] ?? 0) < threshold) continue;
        red += data[index] ?? 0; green += data[index + 1] ?? 0; blue += data[index + 2] ?? 0; count++;
      }
      cells.set([red / count, green / count, blue / count], (row * columns + column) * 3);
    }
  }

  const brightest = new Float32Array(cells.length);
  const smooth = new Float32Array(cells.length);
  forEachNeighbourhood(columns, rows, (cell, neighbours) => {
    const best = neighbours.reduce((winner, other) => brightness(cells, other) > brightness(cells, winner) ? other : winner);
    brightest.set(cells.subarray(best * 3, best * 3 + 3), cell * 3);
  });
  forEachNeighbourhood(columns, rows, (cell, neighbours) => {
    for (let channel = 0; channel < 3; channel++) smooth[cell * 3 + channel] = neighbours.reduce((sum, other) => sum + (brightest[other * 3 + channel] ?? 0), 0) / neighbours.length;
  });

  const cellAt = (column: number, row: number, channel: number) => smooth[(Math.min(rows - 1, Math.max(0, row)) * columns + Math.min(columns - 1, Math.max(0, column))) * 3 + channel] ?? 255;
  return {
    at(x: number, y: number): [number, number, number] {
      const gridX = (x + 0.5) / block - 0.5, gridY = (y + 0.5) / block - 0.5;
      const column = Math.floor(gridX), row = Math.floor(gridY);
      const fractionX = gridX - column, fractionY = gridY - row;
      const channel = (index: number) =>
        (cellAt(column, row, index) * (1 - fractionX) + cellAt(column + 1, row, index) * fractionX) * (1 - fractionY) +
        (cellAt(column, row + 1, index) * (1 - fractionX) + cellAt(column + 1, row + 1, index) * fractionX) * fractionY;
      return [channel(0), channel(1), channel(2)];
    },
  };
}

function brightness(cells: Float32Array, cell: number): number {
  return (cells[cell * 3] ?? 0) + (cells[cell * 3 + 1] ?? 0) + (cells[cell * 3 + 2] ?? 0);
}

function forEachNeighbourhood(columns: number, rows: number, visit: (cell: number, neighbours: number[]) => void) {
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    const neighbours: number[] = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const otherRow = row + dy, otherColumn = column + dx;
      if (otherRow >= 0 && otherRow < rows && otherColumn >= 0 && otherColumn < columns) neighbours.push(otherRow * columns + otherColumn);
    }
    visit(row * columns + column, neighbours);
  }
}

/** Phân vị gần đúng của các giá trị 0..1 (chia 256 mức), đủ chính xác để chọn ngưỡng mà không phải sắp xếp cả ảnh. */
function percentile(values: Float32Array, fraction: number): number {
  if (values.length === 0) return 0;
  const histogram = new Uint32Array(256);
  for (const value of values) histogram[Math.min(255, Math.max(0, Math.round(value * 255)))]!++;
  const wanted = Math.ceil(values.length * fraction);
  for (let level = 0, seen = 0; level < 256; level++) {
    seen += histogram[level] ?? 0;
    if (seen >= wanted) return level / 255;
  }
  return 1;
}

/** Khung bao phần có mực (bỏ 0,2% mực ở mỗi phía để vài hạt bụi xa không kéo giãn khung), cộng thêm lề. */
export function findContentBounds(imageData: ImagePixels, paddingRatio = 0.04): { x: number; y: number; width: number; height: number } | null {
  const { data, width, height } = imageData;
  const columnInk = new Uint32Array(width), rowInk = new Uint32Array(height);
  let total = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if ((data[(y * width + x) * 4 + 3] ?? 0) < 64) continue;
    columnInk[x]!++; rowInk[y]!++; total++;
  }
  if (total === 0) return null;
  const trim = Math.floor(total * 0.002);
  const edge = (counts: Uint32Array, fromEnd: boolean) => {
    for (let step = 0, seen = 0; step < counts.length; step++) {
      const position = fromEnd ? counts.length - 1 - step : step;
      seen += counts[position] ?? 0;
      if (seen > trim) return position;
    }
    return fromEnd ? counts.length - 1 : 0;
  };
  const inkLeft = edge(columnInk, false), inkRight = edge(columnInk, true), inkTop = edge(rowInk, false), inkBottom = edge(rowInk, true);
  const padding = Math.max(2, Math.round(Math.max(inkRight - inkLeft, inkBottom - inkTop) * paddingRatio));
  const left = Math.max(0, inkLeft - padding), right = Math.min(width - 1, inkRight + padding);
  const top = Math.max(0, inkTop - padding), bottom = Math.min(height - 1, inkBottom + padding);
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}
