import { normalizeText } from "../text";

/**
 * Tesseract hay đọc rơi dấu tiếng Việt. Các hàm dưới đây khôi phục dấu bằng từ điển
 * những từ/cụm từ chỉ có một cách viết phổ biến. Chỉ thay một từ khi từ đó hoàn toàn
 * không có dấu, hoặc đã viết đúng như từ điển, để không ghi đè dấu OCR đọc được.
 */

const SURNAMES = ["Nguyễn", "Trần", "Lê", "Phạm", "Hoàng", "Huỳnh", "Vũ", "Võ", "Đặng", "Bùi", "Đỗ", "Hồ", "Ngô", "Dương", "Lý", "Đinh", "Đào", "Trương", "Lương", "Đoàn", "Tạ", "Lâm", "Hà", "Trịnh", "Châu", "Tô", "Quách", "Kiều", "Triệu", "Lưu", "Vương", "Đồng", "Lại", "Mạc", "Tăng", "Từ", "Hứa", "Thái", "Phùng", "Khổng", "Đàm", "Văn", "Lạc", "Ông", "Âu", "Ứng", "Bế", "Nông", "Lục", "Hầu", "Giáp"];
const MIDDLE_NAMES = ["Văn", "Thị", "Đức", "Hữu", "Quốc", "Xuân", "Ngọc", "Công", "Đình", "Bảo", "Hoàng", "Thái", "Trọng", "Quang", "Mạnh", "Tiến", "Thế", "Đăng", "Hồng", "Mỹ", "Phương", "Thúy", "Diệu", "Khánh", "Nhật", "Việt", "Trường", "Tuấn", "Hải", "Bích", "Cẩm", "Huyền", "Hiếu", "Vĩnh", "Phước", "Phúc", "Gia"];
const GIVEN_NAMES = ["Tuấn", "Đức", "Quốc", "Cường", "Thắng", "Đạt", "Hiếu", "Nghĩa", "Phúc", "Lộc", "Sơn", "Việt", "Hương", "Phương", "Trường", "Hải", "Quân", "Nhật", "Khánh", "Toàn", "Thịnh", "Vĩnh", "Bảo", "Ngọc", "Thảo", "Trâm", "Hằng", "Hạnh", "Yến", "Ánh", "Tâm", "Nhân", "Trí", "Tài", "Lực", "Hiển", "Khải", "Kiệt", "Lợi", "Luân", "Nguyệt", "Diễm", "Hồng", "Liễu", "Ngân", "Nhàn", "Thắm", "Thủy", "Tường", "Vượng", "Định", "Hậu", "Tiến", "Thiện", "Triều", "Quyết", "Duẩn", "Hoàng", "Huỳnh", "Phượng", "Uyên", "Xuân", "Nghiêm", "Lĩnh", "Mạnh", "Đông", "Điệp", "Hiền", "Quý"];

const ADMIN_WORDS = ["Xã", "Phường", "Thị trấn", "Thị xã", "Huyện", "Quận", "Thành phố", "Tỉnh", "Thôn", "Ấp", "Tổ", "Tổ dân phố", "Khu phố", "Khu vực", "Xóm", "Bản", "Đường", "Số nhà", "Ngõ", "Ngách", "Hẻm", "Kiệt", "Khối", "Làng", "Buôn", "Khóm", "Đội", "Tập thể", "Chung cư", "Lô"];
const PROVINCES = ["Hà Nội", "Hồ Chí Minh", "Hải Phòng", "Đà Nẵng", "Cần Thơ", "An Giang", "Bà Rịa", "Vũng Tàu", "Bắc Giang", "Bắc Kạn", "Bạc Liêu", "Bắc Ninh", "Bến Tre", "Bình Định", "Bình Dương", "Bình Phước", "Bình Thuận", "Cà Mau", "Cao Bằng", "Đắk Lắk", "Đắk Nông", "Điện Biên", "Đồng Nai", "Đồng Tháp", "Gia Lai", "Hà Giang", "Hà Nam", "Hà Tĩnh", "Hải Dương", "Hậu Giang", "Hòa Bình", "Hưng Yên", "Khánh Hòa", "Kiên Giang", "Kon Tum", "Lai Châu", "Lâm Đồng", "Lạng Sơn", "Lào Cai", "Long An", "Nam Định", "Nghệ An", "Ninh Bình", "Ninh Thuận", "Phú Thọ", "Phú Yên", "Quảng Bình", "Quảng Nam", "Quảng Ngãi", "Quảng Ninh", "Quảng Trị", "Sóc Trăng", "Sơn La", "Tây Ninh", "Thái Bình", "Thái Nguyên", "Thanh Hóa", "Thừa Thiên Huế", "Huế", "Tiền Giang", "Trà Vinh", "Tuyên Quang", "Vĩnh Long", "Vĩnh Phúc", "Yên Bái"];

type Dictionary = Map<string, string[]>;

function buildDictionary(entries: readonly string[]): Dictionary {
  return new Map(entries.map((entry) => [normalizeText(entry), entry.split(" ")]));
}

const SURNAME_DICT = buildDictionary(SURNAMES);
const MIDDLE_DICT = buildDictionary([...MIDDLE_NAMES, ...GIVEN_NAMES]);
const GIVEN_DICT = buildDictionary(GIVEN_NAMES);
const ADDRESS_DICT = buildDictionary([...ADMIN_WORDS, ...PROVINCES]);
const MAX_PHRASE_WORDS = 3;

const hasDiacritics = (word: string) => normalizeText(word) !== word.toLowerCase();

function matchCase(source: string, target: string): string {
  const letters = source.replace(/[^\p{L}]/gu, "");
  if (letters && letters === letters.toUpperCase() && letters !== letters.toLowerCase()) return target.toLocaleUpperCase("vi");
  const lower = target.toLocaleLowerCase("vi");
  return source.charAt(0) === source.charAt(0).toLocaleLowerCase("vi") ? lower : lower.charAt(0).toLocaleUpperCase("vi") + lower.slice(1);
}

/**
 * Thay từng cụm dài nhất khớp từ điển; giữ nguyên dấu câu bám ở đầu/cuối từ.
 * `canOverride` cho phép sửa cả từ đã có dấu (OCR đọc sai dấu) ở những vị trí chắc chắn.
 */
function restoreWords(words: string[], dictionaryAt: (index: number) => Dictionary, canOverride: (index: number, size: number) => boolean = () => false): string[] {
  const output = [...words];
  let index = 0;
  while (index < words.length) {
    let applied = 0;
    const dictionary = dictionaryAt(index);
    for (let size = Math.min(MAX_PHRASE_WORDS, words.length - index); size >= 1 && !applied; size -= 1) {
      const span = words.slice(index, index + size);
      const cores = span.map((word) => word.match(/^([^\p{L}]*)(\p{L}+)([^\p{L}]*)$/u));
      if (cores.some((core) => !core)) continue;
      const target = dictionary.get(normalizeText(cores.map((core) => core![2]).join(" ")));
      if (!target) continue;
      const replaceable = canOverride(index, size) || cores.every((core, offset) => !hasDiacritics(core![2]!) || core![2]!.toLocaleLowerCase("vi") === target[offset]!.toLocaleLowerCase("vi"));
      if (!replaceable) continue;
      cores.forEach((core, offset) => { output[index + offset] = `${core![1]}${matchCase(core![2]!, target[offset]!)}${core![3]}`; });
      applied = size;
    }
    index += applied || 1;
  }
  return output;
}

export function restoreNameDiacritics(name: string): string {
  const words = name.split(" ");
  const last = words.length - 1;
  return restoreWords(words, (index) => index === 0 ? SURNAME_DICT : index === last ? GIVEN_DICT : MIDDLE_DICT).join(" ");
}

const SINGLE_ADMIN_WORDS = new Set(ADMIN_WORDS.filter((word) => !word.includes(" ")).map(normalizeText));
const startsSegment = (words: string[], index: number) => index === 0 || /[,;\-–]$/.test(words[index - 1]!) || words[index - 1] === "-";
const isCapitalizedWord = (word: string | undefined) => Boolean(word && /^\p{Lu}\p{Ll}/u.test(word));

/**
 * Sửa dấu trong địa chỉ. Cụm nhiều từ (Khu phố, Thành phố, tên tỉnh…) và từ hành chính đứng đầu
 * một đoạn (", Phưỡng An Nhơn") được sửa cả khi OCR đọc sai dấu, vì ở vị trí đó chỉ có một cách viết.
 */
export function restoreAddressDiacritics(address: string): string {
  const words = address.split(" ");
  const restored = restoreWords(words, () => ADDRESS_DICT, (index, size) => size > 1 || (startsSegment(words, index) && SINGLE_ADMIN_WORDS.has(normalizeText(words[index]!.replace(/[^\p{L}]/gu, "")))));
  // Tên đường bắt đầu bằng họ Nguyễn ("Nguyên Thái Sơn"), trừ khi là phần sau của tên riêng như "Thái Nguyên".
  return restored.map((word, index) => {
    const core = word.match(/^([^\p{L}]*)(\p{L}+)([^\p{L}]*)$/u);
    const previousIsNamePart = isCapitalizedWord(restored[index - 1]) && !startsSegment(restored, index);
    if (!core || normalizeText(core[2]!) !== "nguyen" || !isCapitalizedWord(restored[index + 1]) || previousIsNamePart) return word;
    return `${core[1]}${matchCase(core[2]!, "Nguyễn")}${core[3]}`;
  }).join(" ");
}
