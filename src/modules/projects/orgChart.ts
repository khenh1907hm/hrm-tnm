/**
 * Sơ đồ tổ chức nhà thầu phụ (mẫu Taikisha "SUBCONTRACTOR ORGANIZATION CHART", BH-02-F02).
 * Nhập trên web thay cho file Excel: khối Văn phòng (trên vạch Head Office) và khối Công trường (dưới vạch),
 * mỗi khối có trục chính và nhánh trái / phải; dưới cùng là các Quản lý nhóm kèm số công nhân.
 * Bố cục tính trên khung 1000 × 707 (tỷ lệ A4 ngang) để màn hình và bản in giống nhau.
 */
import type { ProjectMember } from "./types";

export type OrgSection = "office" | "site";
export type OrgBranch = "main" | "left" | "right";
export type OrgColor = "blue" | "green";

export type OrgPerson = {
  id: string;
  section: OrgSection;
  /** Quản lý nhóm nằm hàng dưới cùng, nối từ thanh ngang của công trường. */
  branch: OrgBranch | "group";
  titleEn: string;
  titleVi: string;
  name: string;
  phone: string;
  email: string;
  /** Ảnh chân dung thu nhỏ (data URL JPEG) để in không phụ thuộc kho tệp. */
  photo: string | null;
  /** Chỉ dùng cho Quản lý nhóm. */
  workerCount: number | null;
  color: OrgColor;
  employeeId: string | null;
};

export type OrgChartHeader = {
  /** Tên nhà thầu phụ (dòng đỏ). */
  contractor: string;
  /** Tên nhà máy / khách hàng (dòng xanh 1). */
  client: string;
  /** Hạng mục (dòng xanh 2). */
  item: string;
  companyName: string;
  companyAddress: string;
  companyPhone: string;
  signDate: string;
  signerTitle: string;
  signerName: string;
  formCode: string;
  emailDomain: string;
  showLogos: boolean;
};

export type OrgChart = { header: OrgChartHeader; people: OrgPerson[] };

export const ORG_CANVAS = { width: 1000, height: 707 } as const;
export const ORG_MAX_GROUPS = 8;

export const DEFAULT_ORG_HEADER: OrgChartHeader = {
  contractor: "THIENNHATMINH CO.LTD",
  client: "",
  item: "",
  companyName: "CÔNG TY TNHH THIÊN NHẬT MINH",
  companyAddress: "75 Nguyễn Cửu Đàm, P. Tân Sơn Nhì,\nTp. Hồ Chí Minh, Việt Nam",
  companyPhone: "(028) 3812 6990",
  signDate: "",
  signerTitle: "Giám đốc",
  signerName: "NGUYỄN GIA LUÂN",
  formCode: "AZ-PG-443-A02 Rev.: 2024.0",
  emailDomain: "thiennhatminh.com",
  showLogos: true,
};

export const blankPerson = (id: string, section: OrgSection, branch: OrgPerson["branch"], titleEn = "", titleVi = ""): OrgPerson => ({
  id, section, branch, titleEn, titleVi, name: "", phone: "", email: "", photo: null,
  workerCount: branch === "group" ? 0 : null, color: section === "office" && branch === "main" ? "blue" : "green", employeeId: null,
});

/** Giám đốc mặc định của công ty trên mọi sơ đồ. */
export const DEFAULT_DIRECTOR = { titleEn: "Director", titleVi: "Giám đốc", name: "NGUYỄN GIA LUÂN", phone: "0983449446", email: "ng.luan@thiennhatminh.com" } as const;

/** Phần dùng chung giữa các dự án (mẫu chung của công ty): tiêu đề trừ khách hàng / hạng mục / ngày, và khối Văn phòng. */
export function toCompanyTemplate(chart: OrgChart): OrgChart {
  return { header: { ...chart.header, client: "", item: "", signDate: "" }, people: chart.people.filter((person) => person.section === "office" && person.branch !== "group") };
}

/**
 * Sơ đồ mới: theo mẫu chung của công ty nếu đã lưu (tiêu đề + khối Văn phòng), không thì Giám đốc mặc định;
 * khối Công trường luôn bắt đầu bằng Quản lý công trường, Nhân viên an toàn, Quản lý nhóm 1.
 */
export function defaultOrgChart(newId: () => string, project: { customerName: string; name: string }, today: string, template: OrgChart | null = null): OrgChart {
  const office = template?.people.filter((person) => person.section === "office" && person.branch !== "group").map((person) => ({ ...person, id: newId() }));
  return {
    header: { ...DEFAULT_ORG_HEADER, ...(template?.header ?? {}), client: project.customerName.toUpperCase(), item: project.name.toUpperCase(), signDate: today },
    people: [
      ...(office?.length ? office : [{ ...blankPerson(newId(), "office", "main", DEFAULT_DIRECTOR.titleEn, DEFAULT_DIRECTOR.titleVi), name: DEFAULT_DIRECTOR.name, phone: DEFAULT_DIRECTOR.phone, email: DEFAULT_DIRECTOR.email }]),
      blankPerson(newId(), "site", "main", "Site Manager", "Quản lý công trường"),
      blankPerson(newId(), "site", "left", "Safety Staff", "Nhân viên an toàn"),
      blankPerson(newId(), "site", "group", "Group Leader #1", "Quản lý nhóm 1"),
    ],
  };
}

/** Bỏ dấu tiếng Việt, chữ thường. */
const plain = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();

/** Email theo quy ước công ty: chữ đầu họ + đệm, chấm, tên ("Nguyễn Gia Luân" → ng.luan@…). */
export function suggestEmail(name: string, domain: string): string {
  const words = plain(name).split(/\s+/).map((word) => word.replace(/[^a-z0-9]/g, "")).filter(Boolean);
  if (!words.length || !domain.trim()) return "";
  const given = words[words.length - 1]!;
  const initials = words.slice(0, -1).map((word) => word[0]).join("");
  return `${initials ? `${initials}.` : ""}${given}@${domain.trim()}`;
}

/** Ngày ký kiểu "Ngày 10 tháng 07 năm 2026". */
export function signDateText(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return match ? `Ngày ${match[3]} tháng ${match[2]} năm ${match[1]}` : "Ngày …… tháng …… năm ……";
}

/** Đánh lại số "Group Leader #n / Quản lý nhóm n" theo thứ tự khi tên vẫn theo mẫu. */
export function renumberGroups(people: OrgPerson[]): OrgPerson[] {
  let index = 0;
  return people.map((person) => {
    if (person.branch !== "group") return person;
    index += 1;
    return {
      ...person,
      titleEn: /^Group Leader #\d*$/.test(person.titleEn) || !person.titleEn ? `Group Leader #${index}` : person.titleEn,
      titleVi: /^Quản lý nhóm \d*$/.test(person.titleVi) || !person.titleVi ? `Quản lý nhóm ${index}` : person.titleVi,
    };
  });
}

/**
 * Điền Quản lý nhóm từ cây thành viên dự án: mỗi tổ trưởng (leader) thành một nhóm,
 * số công nhân = số người có quản lý trực tiếp là tổ trưởng đó. Chỉ huy trưởng thành Quản lý công trường nếu ô đang trống.
 */
export function fillFromMembers(chart: OrgChart, members: readonly ProjectMember[], newId: () => string, today: string): OrgChart {
  const active = members.filter((member) => !member.leftOn || member.leftOn >= today);
  const leaders = active.filter((member) => member.role === "leader");
  const keep = chart.people.filter((person) => person.branch !== "group" || person.name.trim() || person.employeeId);
  const known = new Set(keep.map((person) => person.employeeId).filter(Boolean));
  const added = leaders.filter((leader) => !known.has(leader.employeeId)).map((leader) => ({
    ...blankPerson(newId(), "site", "group"),
    name: leader.displayName.toUpperCase(),
    employeeId: leader.employeeId,
    email: suggestEmail(leader.displayName, chart.header.emailDomain),
    workerCount: active.filter((member) => member.parentId === leader.id).length,
  }));
  // Cập nhật số công nhân của nhóm đã có
  const counted = keep.map((person) => {
    const leader = person.branch === "group" && person.employeeId ? leaders.find((item) => item.employeeId === person.employeeId) : undefined;
    return leader ? { ...person, workerCount: active.filter((member) => member.parentId === leader.id).length } : person;
  });
  const commander = active.find((member) => member.role === "commander");
  const filled = counted.map((person) => person.section === "site" && person.branch === "main" && !person.name.trim() && commander && !counted.some((item) => item.employeeId === commander.employeeId)
    ? { ...person, name: commander.displayName.toUpperCase(), employeeId: commander.employeeId, email: suggestEmail(commander.displayName, chart.header.emailDomain) }
    : person);
  return { ...chart, people: renumberGroups([...filled, ...added].slice(0, 64)) };
}

export type OrgBox = { person: OrgPerson; x: number; y: number; w: number; h: number };
export type OrgLine = { x1: number; y1: number; x2: number; y2: number };
export type OrgLayout = { boxes: OrgBox[]; lines: OrgLine[]; headOfficeY: number; scale: number };

const BOX_W = 232;
const BOX_H = 84;
const GAP_Y = 22;
const SIDE_GAP = 46;
const TOP = 132;
const MARGIN = 24;

/**
 * Tính vị trí các ô và đường nối. Trục chính ở giữa (x = 505). Nhánh phải / trái của văn phòng nối vào trục
 * ngay dưới ô văn phòng cuối; nhánh của công trường nối ngang vào trục, ô thấp nhất nằm trên thanh ngang.
 * Quản lý nhóm xếp một hàng dưới thanh ngang, ô đầu ngay dưới trục, các ô sau sang phải (đủ chỗ thì dời trái).
 * Sơ đồ quá cao thì thu nhỏ cả cụm (scale) để vừa một trang.
 */
export function layoutOrgChart(people: readonly OrgPerson[]): OrgLayout {
  const cx = 505;
  const pick = (section: OrgSection, branch: OrgPerson["branch"]) => people.filter((person) => person.section === section && person.branch === branch);
  const officeMain = pick("office", "main");
  const officeRight = pick("office", "right");
  const officeLeft = pick("office", "left");
  const siteMain = pick("site", "main");
  const siteLeft = pick("site", "left");
  const siteRight = pick("site", "right");
  const groups = people.filter((person) => person.branch === "group").slice(0, ORG_MAX_GROUPS);
  const boxes: OrgBox[] = [];
  const lines: OrgLine[] = [];
  const main = (person: OrgPerson, y: number) => { const box = { person, x: cx - BOX_W / 2, y, w: BOX_W, h: BOX_H }; boxes.push(box); return box; };

  // Văn phòng: trục chính
  let y = TOP;
  let lastBottom = TOP - GAP_Y;
  officeMain.forEach((person) => { const box = main(person, y); lastBottom = box.y + box.h; y += BOX_H + GAP_Y; });
  // Nhánh văn phòng: xếp chồng cạnh trục, bắt đầu thấp hơn ô đầu nửa ô
  const officeJoin = lastBottom + 14;
  const sideStart = TOP + (officeMain.length > 1 ? BOX_H / 2 + GAP_Y : 0);
  const officeSide = (list: OrgPerson[], dir: 1 | -1) => list.forEach((person, index) => {
    const x = dir === 1 ? cx + BOX_W / 2 + SIDE_GAP + 20 : cx - BOX_W / 2 - SIDE_GAP - 20 - BOX_W;
    const box = { person, x, y: sideStart + index * (BOX_H + GAP_Y), w: BOX_W, h: BOX_H };
    boxes.push(box);
    const edge = dir === 1 ? box.x : box.x + box.w;
    const elbow = edge - dir * 22;
    const mid = box.y + box.h / 2;
    lines.push({ x1: edge, y1: mid, x2: elbow, y2: mid }, { x1: elbow, y1: mid, x2: elbow, y2: Math.max(officeJoin, mid) }, { x1: elbow, y1: Math.max(officeJoin, mid), x2: cx, y2: Math.max(officeJoin, mid) });
  });
  officeSide(officeRight, 1);
  officeSide(officeLeft, -1);
  const officeBottom = Math.max(lastBottom, ...boxes.map((box) => box.y + box.h), TOP);
  const sideJoins = boxes.filter((box) => box.person.section === "office" && box.person.branch !== "main").map((box) => Math.max(officeJoin, box.y + box.h / 2));
  const headOfficeY = officeBottom + 18;

  // Công trường
  y = headOfficeY + 22;
  let siteBottom = y - GAP_Y;
  siteMain.forEach((person) => { const box = main(person, y); siteBottom = box.y + box.h; y += BOX_H + GAP_Y; });
  const sideRows = Math.max(siteLeft.length, siteRight.length);
  const busY = Math.max(siteBottom + 34, siteBottom + 34 + (sideRows - 1) * (BOX_H + GAP_Y) - BOX_H / 2 + 16);
  const siteSide = (list: OrgPerson[], dir: 1 | -1) => list.forEach((person, index) => {
    const mid = busY - (list.length - 1 - index) * (BOX_H + GAP_Y);
    const x = dir === 1 ? cx + BOX_W / 2 + SIDE_GAP + 20 : cx - BOX_W / 2 - SIDE_GAP - 20 - BOX_W;
    const box = { person, x: dir === -1 ? Math.max(MARGIN + 50, x - 30) : x, y: mid - BOX_H / 2, w: BOX_W, h: BOX_H };
    boxes.push(box);
    const edge = dir === 1 ? box.x : box.x + box.w;
    lines.push({ x1: edge, y1: mid, x2: cx, y2: mid });
  });
  siteSide(siteLeft, -1);
  siteSide(siteRight, 1);

  // Quản lý nhóm
  const groupTop = busY + 52;
  const gap = 16;
  const span = ORG_CANVAS.width - 2 * MARGIN;
  const gw = groups.length ? Math.min(BOX_W - 20, (span - (groups.length - 1) * gap) / groups.length) : 0;
  let gx = cx - gw / 2;
  const rowWidth = groups.length * gw + (groups.length - 1) * gap;
  if (gx + rowWidth > ORG_CANVAS.width - MARGIN) gx = Math.max(MARGIN, ORG_CANVAS.width - MARGIN - rowWidth);
  const groupBoxes = groups.map((person, index) => { const box = { person, x: gx + index * (gw + gap), y: groupTop, w: gw, h: BOX_H }; boxes.push(box); return box; });

  // Trục dọc: từ ô văn phòng đầu tới thanh ngang (hoặc ô công trường cuối)
  const trunkTop = officeMain.length ? TOP + BOX_H : headOfficeY;
  const trunkBottom = groups.length || siteLeft.length || siteRight.length ? busY : siteBottom;
  const deepestJoin = Math.max(trunkTop, ...sideJoins);
  if (trunkBottom > trunkTop) lines.push({ x1: cx, y1: trunkTop, x2: cx, y2: Math.max(trunkBottom, deepestJoin) });
  else if (deepestJoin > trunkTop) lines.push({ x1: cx, y1: trunkTop, x2: cx, y2: deepestJoin });
  // Thanh ngang công trường và nhánh xuống từng nhóm
  if (groupBoxes.length) {
    const centers = groupBoxes.map((box) => box.x + box.w / 2);
    const left = Math.min(cx, ...centers);
    const right = Math.max(cx, ...centers);
    lines.push({ x1: left, y1: busY, x2: right, y2: busY });
    centers.forEach((center) => lines.push({ x1: center, y1: busY, x2: center, y2: groupTop }));
  }

  const bottom = Math.max(...boxes.map((box) => box.y + box.h), headOfficeY + 40);
  const limit = ORG_CANVAS.height - 40;
  const scale = bottom > limit ? (limit - TOP) / (bottom - TOP) : 1;
  return { boxes, lines, headOfficeY, scale };
}

/** Kiểm tra trước khi lưu. */
export function orgChartIssue(chart: OrgChart): string | null {
  if (!chart.header.contractor.trim()) return "Nhập tên nhà thầu phụ.";
  if (chart.people.filter((person) => person.branch === "group").length > ORG_MAX_GROUPS) return `Tối đa ${ORG_MAX_GROUPS} quản lý nhóm trên một trang.`;
  const bad = chart.people.find((person) => person.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(person.email.trim()));
  if (bad) return `Email của ${bad.name || bad.titleEn || "một ô"} chưa đúng.`;
  const negative = chart.people.find((person) => person.workerCount !== null && (person.workerCount < 0 || !Number.isInteger(person.workerCount)));
  if (negative) return "Số lượng công nhân phải là số nguyên không âm.";
  return null;
}
