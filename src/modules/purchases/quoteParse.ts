/**
 * Đọc báo giá / PO của nhà cung cấp từ chữ có sẵn trong PDF (không dùng AI): mỗi dòng là các ô chữ theo thứ tự trái → phải.
 * Mỗi NCC trình bày một kiểu nên chỉ dò theo những thứ báo giá nào cũng có: MST, ngày, số báo giá, dòng hàng
 * (… số lượng, đơn giá, thành tiền), tổng cộng, điều khoản thanh toán / giao hàng.
 * Kết quả kèm `confident`: dòng hàng khớp số lượng × đơn giá và cộng lại bằng tổng. Không chắc thì nhờ AI đọc lại.
 */
export type QuoteItem = { name: string; spec: string; unit: string; quantity: number; unitPrice: number; amount: number };
export type QuoteData = {
  supplier: string;
  taxCode: string;
  contact: string;
  quoteNo: string;
  quoteDate: string | null;
  items: QuoteItem[];
  subtotal: number | null;
  vat: number | null;
  total: number | null;
  vatIncluded: boolean | null;
  paymentTerms: string;
  advancePct: number | null;
  prepay: boolean;
  deliveryText: string;
};
export type QuoteParse = QuoteData & { confident: boolean; problems: string[] };

/** Công ty mình (bên mua): bỏ qua khi tìm NCC, MST, email. */
const BUYER = /thi[eê]n\s*nh[aậ]t\s*minh|thiennhatminh|0303590774/i;

const clean = (text: string) => text.replace(/\s+/g, " ").trim();
const fold = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();

/** Số kiểu VN / quốc tế: "21,600", "4.320.000", "1.234,5", "200". Không phải số thì null. */
export function parseNumber(raw: string): number | null {
  const text = raw.replace(/\s|VN[DĐ]|đ|₫/gi, "").trim();
  if (!/^-?[\d.,]+$/.test(text) || !/\d/.test(text)) return null;
  const lastDot = text.lastIndexOf("."), lastComma = text.lastIndexOf(",");
  let normal: string;
  if (lastDot >= 0 && lastComma >= 0) {
    const decimal = lastDot > lastComma ? "." : ",";
    normal = text.split(decimal === "." ? "," : ".").join("").replace(decimal, ".");
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? "." : ",";
    const parts = text.split(sep);
    // Nhóm 3 chữ số sau dấu → dấu phân cách hàng nghìn
    normal = parts.length > 2 || (parts[parts.length - 1]!.length === 3 && parts[0]!.length <= 3 && parts[0] !== "0") ? parts.join("") : parts.join(".");
  } else normal = text;
  const value = Number(normal);
  return Number.isFinite(value) ? value : null;
}

const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(2, Math.abs(b) * 0.01);

/** Dòng hàng: cuối dòng có số lượng, đơn giá, thành tiền với SL × ĐG ≈ TT. */
function itemCells(cells: readonly string[]) {
  const numbers: { index: number; value: number }[] = [];
  cells.forEach((cell, index) => { const value = parseNumber(cell); if (value !== null) numbers.push({ index, value }); });
  for (let k = numbers.length - 3; k >= 0; k -= 1) {
    const [q, p, a] = [numbers[k]!, numbers[k + 1]!, numbers[k + 2]!];
    if (q.value > 0 && p.value > 0 && near(q.value * p.value, a.value)) return { qty: q, price: p, amount: a };
  }
  return null;
}

const HEADER = /\b(stt|ten (san pham|hang|vat tu)|description|don gia|thanh tien|unit price|amount|so luong|qty)\b/;
const TOTAL = /\b(tong cong|tong tien|tong gia tri|tong thanh toan|grand total|total|cong tien hang|thanh tien truoc thue|tien thue|thue gtgt|vat)\b/;

export function parseQuoteRows(rows: readonly (readonly string[])[]): QuoteParse {
  const lines = rows.map((cells) => cells.map(clean).filter(Boolean)).filter((cells) => cells.length);
  const joined = lines.map((cells) => cells.join(" "));
  const foldedLines = joined.map(fold);
  const all = joined.join("\n");
  const problems: string[] = [];

  // Nhà cung cấp: dòng "CÔNG TY …" đầu tiên không phải công ty mình
  const supplier = clean(joined.find((line) => /c[oô]ng\s*ty|company|co\.,?\s*ltd|corporation|jsc/i.test(line) && !BUYER.test(line) && line.length < 120)?.replace(/^(kính gửi|to|bên bán|seller)\s*:?/i, "") ?? "");
  const taxCode = [...all.matchAll(/(?:MST|M[aã] s[oố] thu[eế]|Tax\s*code)\s*[:.]?\s*([0-9][0-9 -]{8,15}[0-9])/gi)].map((match) => match[1]!.replace(/\s/g, "")).find((code) => !BUYER.test(code)) ?? "";
  const emails = [...all.matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g)].map((match) => match[0]).filter((mail) => !BUYER.test(mail));
  const phoneLine = joined.find((line) => /cell\s*phone|di[dđ]\s*[dđ]ộng|hotline|mobile/i.test(line) && !BUYER.test(line));
  const phone = phoneLine?.match(/(\+?\d[\d .-]{7,}\d)/)?.[1]?.trim() ?? "";
  const contact = [phone, emails.find((mail) => !/^info@/i.test(mail)) ?? emails[0] ?? ""].filter(Boolean).join(" · ");

  const quoteNo = all.match(/(?:S[oố]\s*(?:P\.?\s*O|b[aá]o\s*gi[aá]|BG|đơn hàng)[^:\n]{0,25}:|Quotation\s*No\.?\s*:?|Quote\s*No\.?\s*:?|Ref\.?\s*No\.?\s*:?|P\.?O\s*No\.?\s*:?)\s*([A-Z0-9][A-Z0-9\-/._]{2,30})/i)?.[1] ?? "";
  const dateMatch = all.match(/(?:ng[aà]y|date)[^0-9\n]{0,40}(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/i);
  const quoteDate = dateMatch ? `${dateMatch[3]}-${dateMatch[2]!.padStart(2, "0")}-${dateMatch[1]!.padStart(2, "0")}` : null;

  // Dòng hàng
  let headerAt = foldedLines.findIndex((line) => HEADER.test(line));
  // Tiêu đề bảng có thể xuống nhiều dòng ("SỐ / LƯỢNG", "(VNĐ)"): bỏ qua các dòng toàn chữ in hoa ngắn ngay sau
  const isHeaderPiece = (cells: readonly string[]) => !itemCells(cells) && cells.every((cell) => cell.length <= 24 && cell === cell.toLocaleUpperCase("vi") && /[A-ZÀ-Ỹ]/.test(cell));
  while (headerAt >= 0 && headerAt + 1 < lines.length && (HEADER.test(foldedLines[headerAt + 1]!) || isHeaderPiece(lines[headerAt + 1]!))) headerAt += 1;
  const itemRows: { at: number; hit: NonNullable<ReturnType<typeof itemCells>> }[] = [];
  lines.forEach((cells, at) => {
    if (at <= headerAt || TOTAL.test(foldedLines[at]!)) return;
    const hit = itemCells(cells);
    if (hit) itemRows.push({ at, hit });
  });
  const totalAt = foldedLines.findIndex((line, at) => at > (itemRows[0]?.at ?? headerAt) && TOTAL.test(line));
  const items: QuoteItem[] = itemRows.map(({ at, hit }, index) => {
    const cells = lines[at]!;
    const before = cells.slice(0, hit.qty.index);
    // Ô chữ cuối trước số lượng là đơn vị tính; ô số đầu (STT) bỏ đi
    const words = before.filter((cell, position) => !(position === 0 && /^\d{1,3}\.?$/.test(cell)));
    const unit = words.length && words[words.length - 1]!.length <= 12 && !/\d{3,}/.test(words[words.length - 1]!) ? words.pop()! : "";
    // Tên hàng có thể nằm ở dòng trên / dưới (ô gộp căn giữa): chia phần giữa hai dòng hàng
    const prevAt = index ? itemRows[index - 1]!.at : headerAt;
    const nextAt = index < itemRows.length - 1 ? itemRows[index + 1]!.at : totalAt >= 0 ? totalAt : Math.min(lines.length, at + 3);
    const gapAbove = Math.max(0, at - prevAt - 1), gapBelow = Math.max(0, nextAt - at - 1);
    const above = lines.slice(at - (index ? Math.floor(gapAbove / 2) : gapAbove), at).map((row) => row.join(" "));
    const below = lines.slice(at + 1, at + 1 + (index < itemRows.length - 1 ? Math.ceil(gapBelow / 2) : gapBelow)).map((row) => row.join(" "));
    const nameParts = [...above, words.join(" "), ...below].map(clean).filter((part) => part && !HEADER.test(fold(part)) && !TOTAL.test(fold(part)));
    const full = clean(nameParts.join(" "));
    // Quy cách trong ngoặc cuối tên (vd mã hàng)
    const spec = full.match(/\(([^()]{2,60})\)\s*$/)?.[1] ?? "";
    return { name: spec ? clean(full.slice(0, full.lastIndexOf("("))) : full, spec, unit, quantity: hit.qty.value, unitPrice: hit.price.value, amount: hit.amount.value };
  });

  // Tổng
  const amountAfter = (pattern: RegExp) => {
    for (let at = foldedLines.length - 1; at >= 0; at -= 1) {
      if (!pattern.test(foldedLines[at]!)) continue;
      const numbers = lines[at]!.map(parseNumber).filter((value): value is number => value !== null && value >= 1000);
      if (numbers.length) return numbers[numbers.length - 1]!;
    }
    return null;
  };
  const total = amountAfter(/\b(tong cong|tong thanh toan|tong gia tri|grand total|total amount|tong tien thanh toan|total)\b/);
  const vat = amountAfter(/\b(thue gtgt|tien thue|vat)\b(?!.*bao gom)/);
  const subtotal = amountAfter(/\b(cong tien hang|thanh tien truoc thue|tong truoc thue|sub ?total)\b/);
  const foldedAll = fold(all);
  const vatIncluded = /(da|duoc)\s*(bao gom|gom|co)\s*(thue|vat|gtgt)|including vat|vat included|incl\.? vat/.test(foldedAll) ? true
    : /chua\s*(bao gom|gom|co)\s*(thue|vat|gtgt)|excluding vat|excl\.? vat|not include vat/.test(foldedAll) ? false : null;

  // Thanh toán, giao hàng
  const payLine = joined.find((line) => /thanh to[aá]n|payment/i.test(line) && /%|ngay|tr[uư][oớ]c|sau|days?/i.test(line)) ?? "";
  const payFold = fold(payLine);
  const pct = Number(payFold.match(/(\d{1,3})\s*%/)?.[1] ?? NaN);
  const advanceWord = /(tam ung|dat coc|advance|deposit)/.test(payFold);
  const prepayWord = /(truoc khi giao|ngay sau khi dat hang|truoc khi nhan hang|thanh toan truoc|before delivery|in advance)/.test(payFold);
  const advancePct = advanceWord && pct > 0 && pct < 100 ? pct : null;
  const prepay = prepayWord && (!Number.isFinite(pct) || pct >= 100);
  const deliveryText = clean(joined.find((line) => /giao h[aà]ng|th[oờ]i gian giao|delivery/i.test(line) && /\d/.test(line)) ?? "");

  // Độ tin cậy
  const sum = items.reduce((acc, item) => acc + item.amount, 0);
  if (!items.length) problems.push("Không tìm thấy dòng hàng (số lượng × đơn giá = thành tiền).");
  if (!supplier) problems.push("Không thấy tên nhà cung cấp.");
  const matchesTotal = total === null ? null : near(sum, total) || (subtotal !== null && near(sum, subtotal)) || (vat !== null && near(sum + vat, total));
  if (items.length && matchesTotal === false) problems.push(`Cộng các dòng ${sum.toLocaleString("vi-VN")} không khớp tổng ${total!.toLocaleString("vi-VN")}.`);
  const confident = items.length > 0 && Boolean(supplier) && matchesTotal !== false;

  return {
    supplier, taxCode, contact, quoteNo, quoteDate, items, subtotal, vat, total, vatIncluded,
    paymentTerms: clean(payLine), advancePct, prepay, deliveryText, confident, problems,
  };
}
