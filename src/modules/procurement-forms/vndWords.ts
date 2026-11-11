/** Đọc số tiền VNĐ thành chữ cho dòng "bằng chữ" trên PO (P-CC-07, P-CC-08). */
const DIGITS = ["không", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín"];

/** Đọc một nhóm 3 chữ số. `full`: nhóm không đứng đầu thì đọc đủ "không trăm", "linh". */
function readGroup(value: number, full: boolean): string {
  const hundreds = Math.floor(value / 100);
  const tens = Math.floor((value % 100) / 10);
  const ones = value % 10;
  const parts: string[] = [];
  if (hundreds || full) parts.push(`${DIGITS[hundreds]} trăm`);
  if (tens === 0) {
    if (ones && (hundreds || full)) parts.push("linh");
  } else if (tens === 1) parts.push("mười");
  else parts.push(`${DIGITS[tens]} mươi`);
  if (ones) {
    if (ones === 5 && tens > 0) parts.push("lăm");
    else if (ones === 1 && tens > 1) parts.push("mốt");
    else parts.push(DIGITS[ones]!);
  }
  return parts.join(" ");
}

/** Số dưới một tỷ. `full`: đứng sau phần "tỷ" nên nhóm đầu cũng đọc đủ. */
function belowBillion(value: number, full: boolean): string {
  const groups = [Math.floor(value / 1_000_000), Math.floor((value % 1_000_000) / 1000), value % 1000];
  const units = [" triệu", " nghìn", ""];
  const words: string[] = [];
  let started = full;
  groups.forEach((group, index) => {
    if (group) { words.push(readGroup(group, started) + units[index]!); started = true; }
  });
  return words.join(" ");
}

/** Số nguyên không âm → chữ (không viết hoa, không có "đồng"). Ví dụ 40.000.000 → "bốn mươi triệu". */
export function numberInWords(amount: number): string {
  const value = Math.round(Math.abs(amount));
  if (value === 0) return "không";
  if (value < 1_000_000_000) return belowBillion(value, false);
  const billions = Math.floor(value / 1_000_000_000);
  const rest = value % 1_000_000_000;
  return `${numberInWords(billions)} tỷ${rest ? ` ${belowBillion(rest, true)}` : ""}`;
}

/** "Bốn mươi triệu đồng chẵn" — viết hoa chữ đầu như cách ghi trên chứng từ. */
export function vndInWords(amount: number): string {
  const text = numberInWords(amount);
  return `${amount < 0 ? "Âm " : ""}${text.charAt(0).toUpperCase()}${text.slice(1)} đồng chẵn`;
}
