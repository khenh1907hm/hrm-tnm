import { normalizeText } from "../../lib/text";
import { isValidISODate } from "../../lib/dates";
import { validateCccd } from "../../lib/vietnam/cccd";
import { correctVietnameseNameTones, validateName } from "../../lib/vietnam/name";
import { validatePhone } from "../../lib/vietnam/phone";
import { restoreAddressDiacritics } from "../../lib/vietnam/restoreDiacritics";

export type ParsedId = {
  cccd: string | null;
  name: string | null;
  dob: string | null;
  gender: "Nam" | "Nữ" | null;
  home: string | null;
  addr: string | null;
  currentAddr: string | null;
  phone: string | null;
};

const empty = (): ParsedId => ({
  cccd: null,
  name: null,
  dob: null,
  gender: null,
  home: null,
  addr: null,
  currentAddr: null,
  phone: null,
});

const SYSTEM_PHRASES = [
  "cong hoa xa hoi chu nghia viet nam",
  "doc lap tu do hanh phuc",
  "can cuoc dien tu",
  "can cuoc cong dan",
  "the can cuoc",
  "can cuoc",
  "giay chung minh nhan dan",
  "so dinh danh ca nhan",
  "personal identification number",
  "viet nam",
  "vietnam",
  "thong tin",
  "lich su",
  "dac diem nhan dang",
  "noi dang ky khai sinh",
  "noi thuong tru",
  "noi tam tru",
  "noi o hien tai",
  "que quan",
  "nguyen quan",
];

function isSystemPhrase(str: string): boolean {
  const norm = normalizeText(str);
  return SYSTEM_PHRASES.some((phrase) => norm === phrase || norm.startsWith(phrase));
}

function cleanAddress(val: string | null): string | null {
  if (!val) return null;
  let cleaned = val.trim();
  let prev = "";
  while (cleaned !== prev) {
    prev = cleaned;
    // 1. Loại bỏ các ký tự dấu phân cách, ngoặc [ ] ( ) { } < >, gạch đứng |, xuyệt / \ ở đầu và cuối
    cleaned = cleaned.replace(/^[\[\](){}<>|/:;.,'"_~+=*?!#@$%^&\\-\s]+|[\[\](){}<>|/:;.,'"_~+=*?!#@$%^&\\-\s]+$/g, "").trim();
    // 2. Loại bỏ các ký tự rác đơn lẻ hoặc cặp rác OCR ở đầu: "ì ", "i ", "l ", "I ", "1 ", "| ", "S] ", "S ] ", "s] ", "s ) "
    cleaned = cleaned.replace(/^(?:[iìíIl!1|]|[SscCjJ]\s*[\]\)\}])(?:\s+|$)/gi, "").trim();
  }
  return cleaned ? restoreAddressDiacritics(cleaned) : null;
}

/** Nhãn ở mặt sau CCCD có thể dính ngay sau địa chỉ trên cùng một dòng. */
const TRAILING_LABELS = [["dac", "diem"], ["nhan", "dang"], ["personal", "identification"], ["ngay", "thang", "nam"], ["date", "month"], ["co", "gia", "tri"], ["date", "of", "expiry"], ["cuc", "truong"], ["ngon", "tro"]];

function cutAtTrailingLabel(line: string): string {
  const words = line.split(/\s+/);
  const normalized = words.map((word) => normalizeText(word).replace(/[^a-z0-9]/g, ""));
  const cut = normalized.findIndex((_, index) => TRAILING_LABELS.some((label) => label.every((part, offset) => normalized[index + offset] === part)));
  return cut < 0 ? line : words.slice(0, cut).join(" ");
}

/** Nhãn viết liền, bỏ dấu; "ð" là chữ "ở" bị OCR đọc nhầm. */
const labelKey = (line: string) => normalizeText(line).replace(/ð/g, "o").replace(/[^a-z0-9]/g, "");
const NEXT_LABEL = /^.{0,2}(?:hovaten|hochudemvaten|fullname|ngaysinh|ngaythangnamsinh|dateofbirth|gioitinh|sex|socccd|cccd|sodinhdanh|sothuebao|dangkytaikhoan|dienthoai|phone|nguyenquan|quequan|noisinh|noidangkykhaisinh|dantoc|tongiao|noithuongtru|thuongtru|noitamtru|tamtru|noicutru|cho[o06d]?hientai|noi[o06d]?hientai|diachihientai|ngaycap|nhommau|nghenghiep|diachithudientu|thongtin|capnhat|dacdiem|nhandang|personalidentification|ngaythangnam|datemonth|cogiatri|dateofexpiry|cuctruong|ngontro|leftindex|rightindex|sochungminh|quoctich|nationality)/;

/** Dòng MRZ ở mặt sau, ví dụ IDVNM0950123456<<... */
const isMrzLine = (line: string) => line.includes("<<") || /^[A-Z0-9<]{20,}$/.test(line.replace(/\s/g, ""));

function stripLabelFromLine(line: string, pattern: RegExp): string {
  const colonIdx = line.search(/[:：]/);
  if (colonIdx >= 0) {
    return line.slice(colonIdx + 1).trim();
  }
  const norm = normalizeText(line);
  const match = norm.match(pattern);
  if (match && match.index === 0) {
    const matchWords = match[0].trim().split(/\s+/).length;
    const originalWords = line.trim().split(/\s+/);
    return originalWords.slice(matchWords).join(" ").replace(/^[:：.\-\s]+/, "").trim();
  }
  return "";
}

export function parseIdText(text: string): ParsedId {
  const result = empty();
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  const getAfter = (pattern: RegExp): string | null => {
    const index = lines.findIndex((line) => pattern.test(normalizeText(line)));
    if (index < 0) return null;
    const line = lines[index] ?? "";
    const sameLine = stripLabelFromLine(line, pattern);
    return sameLine || lines[index + 1]?.trim() || null;
  };

  /** Tìm nhãn theo dạng viết liền không dấu, vì OCR hay dính chữ ("Nơiðhiệntại"). */
  const getAddressAfter = (label: RegExp): string | null => {
    const matcher = new RegExp(`^.{0,2}(?:${label.source})`);
    const index = lines.findIndex((line) => matcher.test(labelKey(line)));
    if (index < 0) return null;
    const labelLine = lines[index]!;
    const colon = labelLine.search(/[:：]/);
    // Không có dấu hai chấm: bỏ số từ ít nhất tạo thành nhãn ("Nơi ở hiện tại Số 12…").
    const words = labelLine.split(/\s+/);
    const labelWords = words.findIndex((_, count) => matcher.test(labelKey(words.slice(0, count + 1).join(" "))));
    const sameLine = colon >= 0 ? labelLine.slice(colon + 1).trim() : words.slice(labelWords + 1).join(" ");
    const values = sameLine ? [cutAtTrailingLabel(sameLine)] : [];
    for (const line of lines.slice(index + 1)) {
      if (NEXT_LABEL.test(labelKey(line)) || isMrzLine(line)) break;
      const kept = cutAtTrailingLabel(line);
      if (kept) values.push(kept);
      if (kept !== line) break;
    }
    return cleanAddress(values.length ? values.join(" ") : null);
  };

  // 1. CCCD
  const cccdCandidate = text.match(/\b\d{3}[\s.]?\d{3}[\s.]?\d{6}\b/)?.[0]?.replace(/[\s.]/g, "") ?? text.match(/\b\d{12}\b/)?.[0] ?? null;
  if (cccdCandidate && validateCccd(cccdCandidate).length === 0) {
    result.cccd = cccdCandidate;
  }

  // 2. Họ và tên
  const nameLabelLine = getAfter(/ho[,.\s]+(?:chu\s+dem\s+va\s+)?ten|full\s*name|ho\s+va\s+ten|chu\s+dem\s+va\s+ten/i);
  if (nameLabelLine) {
    const uppercase = nameLabelLine.match(/\p{Lu}{2,}(?:[\s.'-]+\p{Lu}{2,})+/u)?.[0]?.trim();
    const candidate = uppercase || nameLabelLine.replace(/^.*?(?:ten|name)[:：.\s-]*/i, "").trim();
    if (candidate && !isSystemPhrase(candidate)) {
      const fixed = correctVietnameseNameTones(candidate);
      const validation = validateName(fixed);
      if (!validation.issues.length) result.name = validation.value;
    }
  }

  // Nếu chưa tìm thấy tên từ nhãn, tìm ở 1..4 dòng sau số CCCD (đặc trưng của CCCD và app Căn cước điện tử)
  if (!result.name && result.cccd) {
    const cccdLineIndex = lines.findIndex((line) => line.includes(result.cccd!));
    if (cccdLineIndex >= 0) {
      for (const line of lines.slice(cccdLineIndex + 1, cccdLineIndex + 5)) {
        const uppercase = line.match(/\p{Lu}{2,}(?:[\s.'-]+\p{Lu}{2,})+/u)?.[0]?.trim();
        if (uppercase && !isSystemPhrase(uppercase)) {
          const fixed = correctVietnameseNameTones(uppercase);
          const validation = validateName(fixed);
          if (!validation.issues.length) {
            result.name = validation.value;
            break;
          }
        }
      }
    }
  }

  // Fallback: tìm cụm từ in hoa tiếng Việt hợp lệ trong toàn bộ các dòng
  if (!result.name) {
    for (const line of lines) {
      const uppercase = line.match(/\p{Lu}{2,}(?:[\s.'-]+\p{Lu}{2,})+/u)?.[0]?.trim();
      if (uppercase && !isSystemPhrase(uppercase)) {
        const fixed = correctVietnameseNameTones(uppercase);
        const validation = validateName(fixed);
        if (!validation.issues.length) {
          result.name = validation.value;
          break;
        }
      }
    }
  }

  // 3. Ngày sinh (DOB)
  const dateCandidates: { iso: string; year: number; line: string; index: number }[] = [];
  lines.forEach((line, index) => {
    const matches = line.matchAll(/\b(\d{2})[/-](\d{2})[/-](\d{4})\b/g);
    for (const match of matches) {
      const d = match[1]!;
      const m = match[2]!;
      const y = match[3]!;
      const iso = `${y}-${m}-${d}`;
      if (isValidISODate(iso)) {
        dateCandidates.push({ iso, year: parseInt(y, 10), line, index });
      }
    }
  });

  if (dateCandidates.length > 0) {
    const currentYear = new Date().getFullYear();
    const scored = dateCandidates.map((cand) => {
      let score = 0;
      const lineNorm = normalizeText(cand.line);
      const prevLineNorm = cand.index > 0 ? normalizeText(lines[cand.index - 1] ?? "") : "";

      // Điểm trừ cho ngày cấp / cập nhật / hết hạn
      if (/cap nhat|lan cuoi|update/i.test(lineNorm) || /cap nhat|lan cuoi|update/i.test(prevLineNorm)) score -= 100;
      if (/ngay cap|cap ngay|gan nhat/i.test(lineNorm) || /ngay cap|cap ngay|gan nhat/i.test(prevLineNorm)) score -= 100;
      if (/co gia tri den|gia tri den|den ngay|expiry|het han/i.test(lineNorm) || /co gia tri den|gia tri den|den ngay|expiry|het han/i.test(prevLineNorm)) score -= 100;

      // Điểm cộng cho nhãn ngày sinh
      if (/ngay.*sinh|date of birth|nam sinh|sinh ngay|birth|dse/i.test(lineNorm) || /ngay.*sinh|date of birth|nam sinh|sinh ngay|birth|dse/i.test(prevLineNorm)) score += 50;

      // Độ tuổi lao động hợp lý (14 - 100 tuổi)
      const age = currentYear - cand.year;
      if (age >= 14 && age <= 100) score += 20;
      else score -= 50;

      // Nếu có CCCD 12 số, đối chiếu với năm sinh trong CCCD
      if (result.cccd && result.cccd.length === 12) {
        const cccdYear2 = parseInt(result.cccd.slice(4, 6), 10);
        if (cand.year % 100 === cccdYear2) {
          score += 100;
        } else {
          score -= 80;
        }
      }

      return { ...cand, score };
    });

    scored.sort((a, b) => b.score - a.score);
    if (scored[0] && scored[0].score > 0) {
      result.dob = scored[0].iso;
    }
  }

  // 4. Giới tính
  const genderLine = getAfter(/gioi tinh|sex|di100\/ser/i);
  if (genderLine && /\bnam\b/i.test(genderLine)) result.gender = "Nam";
  else if (genderLine && /\bnu\b/i.test(normalizeText(genderLine))) result.gender = "Nữ";
  // Fallback từ CCCD: số thứ 4 chẵn = Nam, lẻ = Nữ
  if (!result.gender && result.cccd && result.cccd.length === 12) {
    const cccdGenDigit = parseInt(result.cccd[3]!, 10);
    if (!isNaN(cccdGenDigit)) {
      result.gender = cccdGenDigit % 2 === 0 ? "Nam" : "Nữ";
    }
  }

  // 5. Địa chỉ
  result.home = getAddressAfter(/nguyenquan|quequan/);
  result.addr = getAddressAfter(/noithuongtru|thuongtru/);
  // Ưu tiên "Nơi ở hiện tại"; chỉ dùng "Nơi tạm trú" khi không có.
  result.currentAddr = getAddressAfter(/noi[o06d]?hientai|cho[o06d]?hientai|diachihientai|noicutru/) ?? getAddressAfter(/noitamtru|tamtru/);

  // 6. Số điện thoại
  const phoneText = getAfter(/so thue bao|dien thoai|phone|dang ky tai khoan dinh danh/);
  const phoneInline = text.match(/(?:^|\D)(0\d{9})(?:\D|$)/m)?.[1] ?? null;
  const phoneCandidate = phoneText?.match(/0\d{9}/)?.[0] ?? phoneInline;
  if (phoneCandidate && validatePhone(phoneCandidate).issues.length === 0) result.phone = phoneCandidate;

  // Quê quán fallback
  if (!result.home) result.home = getAddressAfter(/quequan/);

  return result;
}

export function mergeParsed(values: ParsedId[]): ParsedId {
  const cccd = values.find((value) => value.cccd !== null)?.cccd ?? null;

  // Ưu tiên dob khớp với CCCD nếu có
  let dob: string | null = null;
  if (cccd && cccd.length === 12) {
    const cccdYear2 = parseInt(cccd.slice(4, 6), 10);
    dob = values.find((value) => value.dob && parseInt(value.dob.slice(2, 4), 10) === cccdYear2)?.dob ?? null;
  }
  if (!dob) {
    dob = values.find((value) => value.dob !== null)?.dob ?? null;
  }

  // Ưu tiên tên có đầy đủ dấu tiếng Việt nhất, sau đó ưu tiên tên dài nhất
  const countVnDiacritics = (s: string) => (s.match(/[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/gi) ?? []).length;
  const names = values.map((value) => value.name).filter((name): name is string => Boolean(name));
  names.sort((a, b) => {
    const aCount = countVnDiacritics(a);
    const bCount = countVnDiacritics(b);
    if (bCount !== aCount) return bCount - aCount;
    return b.length - a.length;
  });
  const name = names[0] ?? null;

  const pick = <K extends keyof ParsedId>(key: K): ParsedId[K] => values.find((value) => value[key] !== null)?.[key] ?? null;

  return {
    cccd,
    name,
    dob,
    gender: pick("gender"),
    home: pick("home"),
    addr: pick("addr"),
    currentAddr: pick("currentAddr"),
    phone: pick("phone"),
  };
}
