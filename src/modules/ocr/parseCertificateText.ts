import { isValidISODate } from "../../lib/dates";

/** Loại giấy nhận ra từ chữ trên giấy (khớp key loại chứng chỉ trong app). */
export type DetectedCertificateKind = "atld" | "health" | "ins" | "elec" | "custom-ctype-cccd" | "custom-ctype-degree" | "custom-ctype-height-health";

export type ParsedCertificate = {
  kind: DetectedCertificateKind | null;
  number?: string;
  issueDate?: string;
  expiryDate?: string;
  /** Nhóm huấn luyện ATLĐ (1–6). */
  safetyGroup?: number;
  /** Tên phân biệt gợi ý: lĩnh vực ATLĐ Nhóm 3 ("Nhóm 3 - Làm việc trên cao"), bậc an toàn điện ("Bậc 3/5"). */
  title?: string;
};

/** Bỏ dấu, chữ thường: OCR hay sai dấu ("ĐÀNG", "CĂNCƯỚC", "Bệc") nên dò trên chữ không dấu. */
function plain(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[đĐ]/g, "d").toLowerCase();
}

const pad = (value: number) => String(value).padStart(2, "0");

/** Ngày → yyyy-mm-dd; năm 2 chữ số coi là 20xx. Ngày không có thật thì bỏ. */
function toIso(day: string, month: string, year: string): string | undefined {
  const iso = `${year.length === 2 ? `20${year}` : year}-${pad(Number(month))}-${pad(Number(day))}`;
  return isValidISODate(iso) && iso >= "1950-01-01" && iso <= "2100-12-31" ? iso : undefined;
}

const NUMERIC_DATE = /(\d{1,2})\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{4})(?!\d)/;
const WORDED_DATE = /ngay\s*[.,:]?\s*(\d{1,2})\s*[.,]?\s*thang\s*[.,]?\s*(\d{1,2})\s*[.,]?\s*nam\s*[.,]?\s*(\d{4})(?!\d)/;

/** Ngày đầu tiên (dạng số hoặc "ngày … tháng … năm …") trong đoạn ngắn ngay sau vị trí `from`. */
function firstDate(source: string, from: number, window = 50): string | undefined {
  const after = source.slice(from, from + window);
  const found = [NUMERIC_DATE.exec(after), WORDED_DATE.exec(after)].filter((item): item is RegExpExecArray => item !== null).sort((a, b) => a.index - b.index);
  for (const match of found) {
    const iso = toIso(match[1]!, match[2]!, match[3]!);
    if (iso) return iso;
  }
  return undefined;
}

/**
 * Bỏ phiếu giữa các lần đọc: giá trị nhiều phiếu nhất phải có ít nhất `minVotes` phiếu và hơn hẳn giá trị khác.
 * Hòa hoặc thiếu phiếu thì không nhận: thà để trống còn hơn điền sai.
 */
function agreed(values: readonly string[], minVotes: number): string | undefined {
  const counts = new Map<string, number>();
  values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  const [best, second] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (!best || best[1] < minVotes || (second && second[1] === best[1])) return undefined;
  return best[0];
}

/** Ngày ngay sau mỗi lần xuất hiện của nhãn. In ở nhiều chỗ (thẻ in hai bản) thì các lần đọc phải khớp nhau. */
function dateAfterLabel(source: string, label: RegExp, window = 50): string | undefined {
  const pattern = new RegExp(label.source, "g");
  const dates: string[] = [];
  for (const match of source.matchAll(pattern)) {
    const iso = firstDate(source, (match.index ?? 0) + match[0].length, window);
    if (iso) dates.push(iso);
  }
  return agreed(dates, dates.length > 1 ? 2 : 1);
}

/** Tiền tố các dòng do bước đọc lại dòng số thêm vào (readDocumentText). */
const READ_AGAIN = "#doclai ";
/** Chữ của lượt đọc cả trang (bỏ các dòng đọc lại). */
const mainRead = (source: string) => source.split("\n").filter((line) => !line.startsWith(READ_AGAIN)).join("\n");

/**
 * Số đọc được ở mọi lần (cả trang + các lần đọc lại dòng số): cần ít nhất 2 lần khớp nhau, và số đó phải có trong
 * lượt đọc cả trang. Hai lần đọc lại cùng một dòng có thể cùng nhầm giống nhau; khớp giữa hai nguồn độc lập thì chắc hơn.
 */
function agreedNumber(source: string, pattern: RegExp, format: (match: RegExpMatchArray) => string): string | undefined {
  const all = (text: string) => [...text.matchAll(new RegExp(pattern.source, "g"))].map(format);
  const winner = agreed(all(source), 2);
  return winner && all(mainRead(source)).includes(winner) ? winner : undefined;
}

function detectKind(source: string): DetectedCertificateKind | null {
  if (/can\s*cuoc|citizen identity|[i1l|]dvnm|\d{6,7}[mf<]\d{6,7}vnm/.test(source)) return "custom-ctype-cccd";
  if (/the an toan dien|b[ae]c an toan/.test(source)) return "elec";
  if (/the an toan lao dong|huan luyen an toan/.test(source)) return "atld";
  if (/chung chi hanh nghe/.test(source) && /lam viec tren cao/.test(source)) return "custom-ctype-height-health";
  if (/giay kham suc khoe/.test(source)) return "health";
  if (/bao hiem/.test(source) && /hop dong/.test(source)) return "ins";
  // OCR hay mất chữ "BẰNG" ở tiêu đề → nhận theo "tốt nghiệp" (giấy làm việc trên cao có "văn bằng" đã nhận ở trên)
  if (/tot nghiep|van bang/.test(source)) return "custom-ctype-degree";
  return null;
}

/** Chữ số kiểm tra của mã máy đọc (MRZ, ICAO 9303): trọng số 7-3-1. */
function mrzCheckDigit(digits: string): number {
  return [...digits].reduce((sum, digit, index) => sum + Number(digit) * [7, 3, 1][index % 3]!, 0) % 10;
}

/** Các chữ số OCR hay đọc nhầm sang nhau. */
const CONFUSABLE: Readonly<Record<string, string>> = { "0": "86", "1": "7", "3": "589", "5": "36", "6": "508", "7": "1", "8": "3069", "9": "38" };

/**
 * Hạn CCCD từ dòng MRZ mặt sau: "YYMMDD(c) giới tính YYMMDD(c) VNM" (ngày sinh, hạn). Hạn CCCD luôn đúng
 * ngày-tháng sinh (tròn 25/40/60 tuổi), kết hợp chữ số kiểm tra để sửa một chữ số OCR đọc nhầm.
 */
function cccdExpiryFromMrz(source: string): string | undefined {
  const mrz = /(\d{6})(\d)[mf<]\s*(\d{6})(\d)\s*vnm/.exec(source.replace(/[ \t]/g, ""));
  if (!mrz) return undefined;
  const [, birth, birthCheck, expiry, expiryCheck] = mrz as unknown as [string, string, string, string, string];
  if (mrzCheckDigit(birth) !== Number(birthCheck)) return undefined;
  const candidates = new Set<string>([expiry]);
  [...expiry].forEach((digit, index) => [...(CONFUSABLE[digit] ?? "")].forEach((other) => candidates.add(expiry.slice(0, index) + other + expiry.slice(index + 1))));
  const valid = [...candidates].filter((value) => mrzCheckDigit(value) === Number(expiryCheck) && value.slice(2) === birth.slice(2));
  if (valid.length !== 1) return undefined;
  return toIso(valid[0]!.slice(4, 6), valid[0]!.slice(2, 4), `20${valid[0]!.slice(0, 2)}`);
}

function parseCccd(source: string, result: ParsedCertificate) {
  // Số CCCD: 12 chữ số, bắt đầu bằng 0 (mã tỉnh)
  // Phải khớp số nằm trong dòng MRZ ("IDVNM…<số CCCD><<") hoặc đọc được 2 lần
  const numbers = [...source.matchAll(/(?<![\d])(0\d{11})(?![\d])/g)].map((match) => match[1]!);
  // Dòng MRZ 1 = "IDVNM" + 9 số cuối CCCD + chữ số kiểm tra + 12 số CCCD (OCR có khi cắt cụt phần sau)
  const mrz = /[i1l|]dvnm(\d{10,})/.exec(source)?.[1] ?? "";
  const number = numbers.find((value) => source.includes(`${value}<`) || (mrz && mrz.startsWith(value.slice(3)))) ?? agreed(numbers, 2);
  if (number) result.number = number;
  const expiry = dateAfterLabel(source, /(co gia tri den|date of expiry|gia tri den)/) ?? cccdExpiryFromMrz(source);
  if (expiry) result.expiryDate = expiry;
  const issue = dateAfterLabel(source, /(date, month, year|ngay, thang, nam)\s*:?/, 30);
  if (issue) result.issueDate = issue;
}

/** Lĩnh vực của thẻ ATLĐ Nhóm 3 (bắt đúng cụm, "xây dựng" đứng một mình còn có trong câu "được xây dựng theo Nghị định"). */
const ATLD_FIELDS: readonly [RegExp, string][] = [
  [/lam viec tren cao/, "Làm việc trên cao"],
  [/linh vuc dien/, "Lĩnh vực điện"],
  [/cong trinh[\s\S]{0,20}?xay d/, "Công trình xây dựng"],
];

function parseAtld(source: string, result: ParsedCertificate) {
  // Hạn: thẻ "Thẻ này có giá trị đến ngày: 28/04/2027"; giấy chứng nhận "có giá trị 2 năm từ ngày … đến ngày 10 tháng 6 năm 2026".
  // Không dùng "Từ ngày … đến ngày …" đứng một mình: đó là thời gian học.
  const expiry = dateAfterLabel(source, /gia tri den\s*ngay\s*:?/) ?? dateAfterLabel(source, /gia tri\s*\d\s*nam[\s\S]{0,60}?den\s*(?=ngay)/, 40);
  if (expiry) result.expiryDate = expiry;
  // Ngày cấp: dòng "Tp. Hồ Chí Minh, ngày 28/04/2025" (thẻ) hoặc "…, ngày 10 tháng 6 năm 2024" (giấy chứng nhận)
  const issued = [...source.matchAll(/(chi minh|hcm)[^\n]{0,8}?(?=ngay)/g)]
    .map((match) => firstDate(source, (match.index ?? 0) + match[0].length, 30))
    .filter((iso): iso is string => Boolean(iso) && (!result.expiryDate || iso! < result.expiryDate));
  const issue = agreed(issued, issued.length > 1 ? 2 : 1);
  if (issue) result.issueDate = issue;

  const groups = [...source.matchAll(/nhom\s*([1-6])(?!\d)/g)].map((match) => match[1]!);
  const group = agreed(groups, 1);
  if (group) result.safetyGroup = Number(group);

  // Số thẻ "25E0159/2025/TATLĐ", số giấy chứng nhận "24F00815/N1/2024". Số quyết định "25E06-044/QĐ" có gạch nên không khớp.
  const candidates: { core: string; middle: string; main: boolean }[] = [];
  // Các lần đọc lại dòng số hay cụt phần "/TATLĐ" và có khi mất dấu "/" ("25E0I592025") nên chỉ cần "mã[/]năm" hoặc "mã/N1".
  // Mã dài 4–5 ký tự sau "25E", lấy ngắn nhất mà phía sau là năm 20xx → tách đúng cả khi dính liền năm.
  for (const match of source.matchAll(/(\d{2}[a-z][0-9a-z]{4,5}?)\s*\/?\s*(20\d{2}|n\d)/g)) {
    // Sau 3 ký tự đầu chỉ có chữ số: sửa I/l → 1, O/u → 0 do OCR
    const core = match[1]!.slice(0, 3).toUpperCase() + match[1]!.slice(3).replace(/[il|]/g, "1").replace(/[ou]/g, "0");
    // Lần đọc này thuộc lượt đọc cả trang hay một dòng đọc lại "so: …"
    const lineStart = source.lastIndexOf("\n", match.index ?? 0) + 1;
    if (/^\d{2}[A-Z]\d{4,6}$/.test(core)) candidates.push({ core, middle: match[2]!, main: !source.startsWith(READ_AGAIN, lineStart) });
  }
  // Số thẻ in hai bản + các lần đọc lại dòng số: cần ít nhất 2 lần khớp nhau, và có trong lượt đọc cả trang
  const winner = agreed(candidates.map((item) => item.core), 2);
  const core = winner && candidates.some((item) => item.core === winner && item.main) ? winner : undefined;
  if (core) {
    const certificate = candidates.find((item) => item.core === core && item.middle.startsWith("n"));
    const year = result.issueDate?.slice(0, 4);
    // Năm trong số thẻ là năm cấp: OCR đọc sai năm thì lấy theo ngày cấp
    result.number = certificate
      ? `${core}/${certificate.middle.toUpperCase()}/${year ?? ""}`.replace(/\/$/, "")
      : `${core}/${year ?? candidates.find((item) => item.core === core)!.middle}/TATLĐ`;
  }

  if (result.safetyGroup) {
    const field = result.safetyGroup === 3 ? ATLD_FIELDS.find(([pattern]) => pattern.test(source)) : undefined;
    result.title = field ? `Nhóm ${result.safetyGroup} - ${field[1]}` : `Nhóm ${result.safetyGroup}`;
  }
}

function parseElectrical(source: string, result: ParsedCertificate) {
  const number = agreedNumber(source, /s[o0]\s*[:.]?\s*(\d{1,4})\s*\/\s*([a-z]{2,4}|\d{4})\s*\/\s*tat[dđ]/, (match) => `${match[1]}/${match[2]!.toUpperCase()}/TATĐ`);
  if (number) result.number = number;
  const levels = [...source.matchAll(/b[ae]c an to[a-z]n[^\d\n]{0,6}([1-5])\s*\/\s*5/g)].map((match) => match[1]!);
  const level = agreed(levels, 1);
  if (level) result.title = `Bậc ${level}/5`;
  const issue = dateAfterLabel(source, /c[a]p ngay\s*[:;.]?/, 25);
  if (issue) result.issueDate = issue;
  const expiry = dateAfterLabel(source, /(gia tri den|het han)\s*(ngay)?\s*:?/);
  if (expiry) result.expiryDate = expiry;
}

function parseInsurance(source: string, result: ParsedCertificate) {
  const number = agreedNumber(source, /s[o0]\s*[:.]?\s*([a-z]-\d{2}\/[a-z0-9]+\/[a-z0-9]+\/\d+\/\d+)/, (match) => match[1]!.toUpperCase());
  if (number) result.number = number;
  // Thời hạn bảo hiểm "Từ 00:00 h ngày 01/01/2026 đến 23:59 h ngày 31/12/2026": ngày cấp = ngày bắt đầu được bảo hiểm
  const from = dateAfterLabel(source, /tu\s*\d{1,2}[:.]\d{2}\s*h?\s*/, 25);
  if (from) result.issueDate = from;
  const to = dateAfterLabel(source, /den\s*\d{1,2}[:.]\d{2}\s*h?\s*/, 25);
  if (to) result.expiryDate = to;
}

/**
 * Lấy số/mã, ngày cấp, ngày hết hạn, nhóm/bậc từ chữ OCR của giấy chứng chỉ.
 * Mẫu dựa trên hồ sơ giấy thật: thẻ và giấy chứng nhận ATLĐ, thẻ an toàn điện, CCCD, giấy khám sức khỏe,
 * hợp đồng bảo hiểm tai nạn, bằng tốt nghiệp. Chữ viết tay OCR không đọc được; không chắc thì bỏ trống, không đoán.
 */
export function parseCertificateText(raw: string, options: { today?: string } = {}): ParsedCertificate {
  const source = plain(raw);
  const result: ParsedCertificate = { kind: detectKind(source) };
  switch (result.kind) {
    case "custom-ctype-cccd": parseCccd(source, result); break;
    case "atld": parseAtld(source, result); break;
    case "elec": parseElectrical(source, result); break;
    case "ins": parseInsurance(source, result); break;
    case "health": {
      const number = agreedNumber(source, /s[o0]\s*[:.]?[\s.]*(\d{3,6})[\s.]*\/\s*gksk/, (match) => `${match[1]}/GKSK`);
      if (number) result.number = number;
      break;
    }
    case "custom-ctype-degree": {
      const number = agreedNumber(source, /s[o0]\s*:?\s*([a-z])\s*(\d{6})(?!\d)/, (match) => `${match[1]!.toUpperCase()} ${match[2]}`);
      if (number) result.number = number;
      break;
    }
    default: {
      const expiry = dateAfterLabel(source, /(gia tri den|het han)\s*(ngay)?\s*:?/);
      if (expiry) result.expiryDate = expiry;
      const issue = dateAfterLabel(source, /(cap ngay|ngay cap)\s*:?/);
      if (issue) result.issueDate = issue;
    }
  }
  // Chốt chặn: ngày cấp đọc nhầm (ở tương lai, sau ngày hết hạn, CCCD trước khi có CCCD năm 2016) thì bỏ, không điền
  const issue = result.issueDate;
  if (issue && ((options.today && issue > options.today) || (result.expiryDate && issue > result.expiryDate) || (result.kind === "custom-ctype-cccd" && issue < "2016-01-01"))) delete result.issueDate;
  return result;
}
