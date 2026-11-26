/**
 * Đọc trang tính đầu tiên của file Excel 97-2003 (.xls, BIFF8 trong vỏ OLE/CFB) thành bảng ô (chỉ giá trị chữ / số).
 * Không đọc macro, hình, công thức (chỉ lấy kết quả đã lưu). Đủ cho các biểu mẫu nhập liệu của công ty.
 */
export type SheetCell = string | number | null;

const ENDOFCHAIN = 0xfffffffe;
const FREESECT = 0xffffffff;

function readCfbStream(bytes: Uint8Array, names: readonly string[]): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const signature = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  if (bytes.length < 512 || signature.some((value, index) => bytes[index] !== value)) throw new Error("XLS_NOT_OLE");
  const sectorSize = 1 << view.getUint16(30, true);
  const miniSectorSize = 1 << view.getUint16(32, true);
  const fatSectors = view.getUint32(44, true);
  const firstDir = view.getUint32(48, true);
  const miniCutoff = view.getUint32(56, true);
  const firstMiniFat = view.getUint32(60, true);
  let difatSector = view.getUint32(68, true);
  const sectorOffset = (sector: number) => (sector + 1) * sectorSize;
  // Danh sách sector chứa bảng FAT: 109 mục đầu trong header, phần còn lại theo chuỗi DIFAT
  const fatList: number[] = [];
  for (let index = 0; index < 109 && fatList.length < fatSectors; index += 1) fatList.push(view.getUint32(76 + index * 4, true));
  let guard = 0;
  while (fatList.length < fatSectors && difatSector !== ENDOFCHAIN && difatSector !== FREESECT && guard++ < 10_000) {
    const base = sectorOffset(difatSector);
    for (let index = 0; index < sectorSize / 4 - 1 && fatList.length < fatSectors; index += 1) fatList.push(view.getUint32(base + index * 4, true));
    difatSector = view.getUint32(base + sectorSize - 4, true);
  }
  const fat: number[] = [];
  for (const sector of fatList) {
    const base = sectorOffset(sector);
    for (let index = 0; index < sectorSize / 4; index += 1) fat.push(base + index * 4 + 4 <= bytes.length ? view.getUint32(base + index * 4, true) : FREESECT);
  }
  const chain = (start: number, table: readonly number[]) => {
    const out: number[] = [];
    let sector = start;
    while (sector !== ENDOFCHAIN && sector !== FREESECT && sector < table.length && out.length < 1_000_000) { out.push(sector); sector = table[sector]!; }
    return out;
  };
  const readChain = (start: number) => {
    const sectors = chain(start, fat);
    const out = new Uint8Array(sectors.length * sectorSize);
    sectors.forEach((sector, index) => out.set(bytes.subarray(sectorOffset(sector), sectorOffset(sector) + sectorSize), index * sectorSize));
    return out;
  };
  const dir = readChain(firstDir);
  const dirView = new DataView(dir.buffer);
  type Entry = { name: string; type: number; start: number; size: number };
  const entries: Entry[] = [];
  for (let offset = 0; offset + 128 <= dir.length; offset += 128) {
    const nameLength = dirView.getUint16(offset + 64, true);
    let name = "";
    for (let index = 0; index < Math.max(0, nameLength / 2 - 1); index += 1) name += String.fromCharCode(dirView.getUint16(offset + index * 2, true));
    entries.push({ name, type: dir[offset + 66]!, start: dirView.getUint32(offset + 116, true), size: dirView.getUint32(offset + 120, true) });
  }
  const entry = entries.find((item) => item.type === 2 && names.includes(item.name));
  if (!entry) throw new Error("XLS_NO_WORKBOOK");
  if (entry.size >= miniCutoff) return readChain(entry.start).subarray(0, entry.size);
  // Luồng nhỏ nằm trong mini stream của Root Entry
  const root = entries[0]!;
  const miniStream = readChain(root.start);
  const miniFatBytes = readChain(firstMiniFat);
  const miniFat: number[] = [];
  for (let index = 0; index + 4 <= miniFatBytes.length; index += 4) miniFat.push(new DataView(miniFatBytes.buffer).getUint32(index, true));
  const sectors = chain(entry.start, miniFat);
  const out = new Uint8Array(sectors.length * miniSectorSize);
  sectors.forEach((sector, index) => out.set(miniStream.subarray(sector * miniSectorSize, (sector + 1) * miniSectorSize), index * miniSectorSize));
  return out.subarray(0, entry.size);
}

type Record = { type: number; data: Uint8Array };
function records(stream: Uint8Array): Record[] {
  const out: Record[] = [];
  const view = new DataView(stream.buffer, stream.byteOffset, stream.byteLength);
  for (let offset = 0; offset + 4 <= stream.length;) {
    const type = view.getUint16(offset, true), size = view.getUint16(offset + 2, true);
    out.push({ type, data: stream.subarray(offset + 4, offset + 4 + size) });
    offset += 4 + size;
  }
  return out;
}

/** Bảng chuỗi dùng chung (SST), các chuỗi có thể vắt qua bản ghi CONTINUE. */
function readSst(parts: readonly Uint8Array[]): string[] {
  let part = 0, pos = 8;
  const total = parts[0] && parts[0].length >= 8 ? new DataView(parts[0].buffer, parts[0].byteOffset).getUint32(4, true) : 0;
  const strings: string[] = [];
  const ensure = () => { while (part < parts.length && pos >= parts[part]!.length) { part += 1; pos = 0; } return part < parts.length; };
  const u8 = () => { ensure(); return parts[part]![pos++] ?? 0; };
  const u16 = () => u8() | (u8() << 8);
  const u32 = () => (u16() | (u16() << 16)) >>> 0;
  const skip = (count: number) => { for (let index = 0; index < count; index += 1) u8(); };
  for (let index = 0; index < total && ensure(); index += 1) {
    const length = u16();
    let flags = u8();
    const runs = flags & 0x08 ? u16() : 0;
    const ext = flags & 0x04 ? u32() : 0;
    let text = "";
    for (let read = 0; read < length;) {
      // Hết bản ghi giữa chuỗi: bản ghi CONTINUE mở đầu bằng 1 byte cờ (chữ 1 hay 2 byte)
      if (pos >= parts[part]!.length) { part += 1; pos = 0; if (part >= parts.length) break; flags = (flags & ~1) | (parts[part]![pos++]! & 1); }
      const wide = flags & 1;
      const available = wide ? Math.floor((parts[part]!.length - pos) / 2) : parts[part]!.length - pos;
      const take = Math.min(length - read, available);
      for (let k = 0; k < take; k += 1) text += String.fromCharCode(wide ? parts[part]![pos + k * 2]! | (parts[part]![pos + k * 2 + 1]! << 8) : parts[part]![pos + k]!);
      pos += wide ? take * 2 : take;
      read += take;
      if (take === 0 && available === 0 && pos < parts[part]!.length) pos = parts[part]!.length;
    }
    skip(runs * 4 + ext);
    strings.push(text);
  }
  return strings;
}

const rk = (value: number) => {
  const multiplied = value & 1, integer = value & 2;
  let number: number;
  if (integer) number = value >> 2;
  else { const buffer = new DataView(new ArrayBuffer(8)); buffer.setUint32(4, value & 0xfffffffc, true); buffer.setUint32(0, 0, true); number = buffer.getFloat64(0, true); }
  return multiplied ? number / 100 : number;
};

function unicodeString(data: Uint8Array, offset: number): string {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const length = view.getUint16(offset, true);
  const flags = data[offset + 2]!;
  let pos = offset + 3;
  if (flags & 0x08) pos += 2;
  if (flags & 0x04) pos += 4;
  let text = "";
  for (let index = 0; index < length && pos < data.length; index += 1) {
    text += String.fromCharCode(flags & 1 ? view.getUint16(pos, true) : data[pos]!);
    pos += flags & 1 ? 2 : 1;
  }
  return text;
}

/** Trang tính đầu tiên thành mảng dòng × cột (0-based). */
export function readXlsFirstSheet(input: ArrayBuffer | Uint8Array): SheetCell[][] {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const stream = readCfbStream(bytes, ["Workbook", "Book"]);
  const list = records(stream);
  let sst: string[] = [];
  const grid: SheetCell[][] = [];
  const set = (row: number, col: number, value: SheetCell) => { (grid[row] ??= [])[col] = value; };
  let bofCount = 0, inSheet = false, pendingFormula: [number, number] | null = null;
  for (let index = 0; index < list.length; index += 1) {
    const { type, data } = list[index]!;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    if (type === 0x0809) { bofCount += 1; inSheet = bofCount === 2 && data.length >= 4 && view.getUint16(2, true) === 0x0010; continue; }
    if (type === 0x000a) { if (inSheet) break; continue; }
    if (type === 0x00fc) {
      const parts = [data];
      while (list[index + 1]?.type === 0x003c) parts.push(list[++index]!.data);
      sst = readSst(parts);
      continue;
    }
    if (type === 0x0207) { if (inSheet && pendingFormula && data.length >= 3) set(pendingFormula[0], pendingFormula[1], unicodeString(data, 0)); pendingFormula = null; continue; }
    if (!inSheet || data.length < 6) continue;
    const row = view.getUint16(0, true), col = view.getUint16(2, true);
    if (type === 0x00fd && data.length >= 10) set(row, col, sst[view.getUint32(6, true)] ?? "");
    else if (type === 0x0203 && data.length >= 14) set(row, col, view.getFloat64(6, true));
    else if (type === 0x027e && data.length >= 10) set(row, col, rk(view.getInt32(6, true)));
    else if (type === 0x00bd) {
      const last = view.getUint16(data.length - 2, true);
      for (let c = col, pos = 4; c <= last && pos + 6 <= data.length - 2; c += 1, pos += 6) set(row, c, rk(view.getInt32(pos + 2, true)));
    } else if (type === 0x0204 && data.length >= 9) set(row, col, unicodeString(data, 6));
    else if (type === 0x0006 && data.length >= 14) {
      // Công thức: kết quả số lưu thẳng; kết quả chữ nằm ở bản ghi STRING ngay sau
      if (view.getUint16(12, true) === 0xffff && data[6] === 0) pendingFormula = [row, col];
      else if (view.getUint16(12, true) !== 0xffff) set(row, col, view.getFloat64(6, true));
    }
  }
  return grid.map((line) => Array.from({ length: line?.length ?? 0 }, (_, c) => line?.[c] ?? null));
}
