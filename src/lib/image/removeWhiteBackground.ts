export type ImagePixels = { data: Uint8ClampedArray; width: number; height: number };

export function removeWhiteBackground(imageData: ImagePixels): ImagePixels {
  const data = new Uint8ClampedArray(imageData.data);
  for (let index = 0; index < data.length; index += 4) {
    const red = data[index] ?? 0;
    const green = data[index + 1] ?? 0;
    const blue = data[index + 2] ?? 0;
    const brightness = Math.round((red + green + blue) / 3);
    // Chỉ làm trong thêm, không làm đục lại: ảnh đã tách nền sẵn (vd từ AI) giữ nguyên độ trong suốt
    const alpha = data[index + 3] ?? 255;
    if (brightness > 225) data[index + 3] = 0;
    else if (brightness >= 160) data[index + 3] = Math.min(alpha, Math.round((225 - brightness) / 65 * 255));
  }
  return { data, width: imageData.width, height: imageData.height };
}
