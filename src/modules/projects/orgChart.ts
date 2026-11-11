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
  workerCount: branch === "group" ? 0 : null, color: "blue", employeeId: null,
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

/** Chức vụ theo vai trò trong dự án: vị trí trên sơ đồ và tên chức vụ Anh / Việt. */
const ROLE_SLOT: Partial<Record<ProjectMember["role"], { section: OrgSection; branch: OrgPerson["branch"]; titleEn: string; titleVi: string }>> = {
  pm: { section: "office", branch: "main", titleEn: "Project Manager", titleVi: "Quản lý dự án" },
  commander: { section: "site", branch: "main", titleEn: "Site Manager", titleVi: "Quản lý công trường" },
  supervisor: { section: "site", branch: "right", titleEn: "Supervisor", titleVi: "Giám sát" },
  engineer: { section: "site", branch: "right", titleEn: "Engineer", titleVi: "Kỹ sư" },
  leader: { section: "site", branch: "group", titleEn: "", titleVi: "" },
};

/**
 * Đồng bộ sơ đồ với thành viên đang làm của dự án: PM → khối Văn phòng, CHT → Quản lý công trường (điền ô trống nếu có),
 * giám sát / kỹ sư → nhánh phải công trường, tổ trưởng → Quản lý nhóm, số công nhân = số người dưới tổ trưởng.
 * Người đã có trên sơ đồ (cùng nhân sự) giữ nguyên ô, chỉ cập nhật số công nhân. Ô nhóm trống của mẫu bỏ khi đã có tổ trưởng thật.
 */
export function mergeMembers(chart: OrgChart, members: readonly ProjectMember[], newId: () => string, today: string): OrgChart {
  const active = members.filter((member) => !member.leftOn || member.leftOn >= today);
  const workersOf = (member: ProjectMember) => active.filter((item) => item.parentId === member.id).length;
  let people = chart.people.map((person) => {
    const leader = person.branch === 'group' && person.employeeId ? active.find((member) => member.role === 'leader' && member.employeeId === person.employeeId) : undefined;
    return leader ? { ...person, workerCount: workersOf(leader) } : person;
  });
  const known = new Set(people.map((person) => person.employeeId).filter(Boolean));
  const added: OrgPerson[] = [];
  for (const member of active) {
    const slot = ROLE_SLOT[member.role];
    if (!slot || known.has(member.employeeId)) continue;
    known.add(member.employeeId);
    // Email không có trong hồ sơ: để trống, người lập tự nhập hoặc bấm Gợi ý
    const filled = { name: member.displayName.toUpperCase(), employeeId: member.employeeId };
    const emptySite = slot.section === 'site' && slot.branch === 'main' ? people.find((person) => person.section === 'site' && person.branch === 'main' && !person.name.trim()) : undefined;
    if (emptySite) { people = people.map((person) => person === emptySite ? { ...person, ...filled } : person); continue; }
    added.push({ ...blankPerson(newId(), slot.section, slot.branch, slot.titleEn, slot.titleVi), ...filled, workerCount: slot.branch === 'group' ? workersOf(member) : null });
  }
  if (added.some((person) => person.branch === 'group')) people = people.filter((person) => !(person.branch === 'group' && !person.name.trim() && !person.employeeId));
  return { ...chart, people: renumberGroups([...people, ...added].slice(0, 64)) };
}

/** Sơ đồ mới dựng từ dữ liệu: mẫu chung (tiêu đề + Văn phòng) rồi đồng bộ thành viên dự án. */
export function buildFromProject(newId: () => string, project: { customerName: string; name: string }, today: string, template: OrgChart | null, members: readonly ProjectMember[]): OrgChart {
  return mergeMembers(defaultOrgChart(newId, project, today, template), members, newId, today);
}

/** Thông tin hồ sơ nhân sự để điền ô: tên, số điện thoại, ảnh (đã thu nhỏ). Trường trống thì giữ giá trị cũ. */
export type EmployeeFacts = { name?: string | undefined; phone?: string | undefined; photo?: string | null };
export function applyEmployeeFacts(person: OrgPerson, facts: EmployeeFacts, overwrite: boolean): OrgPerson {
  const take = (current: string, next: string | undefined) => next && (overwrite || !current.trim()) ? next : current;
  return {
    ...person,
    name: take(person.name, facts.name?.toUpperCase()),
    phone: take(person.phone, facts.phone),
    photo: facts.photo && (overwrite || !person.photo) ? facts.photo : person.photo,
  };
}

export type OrgBox = { person: OrgPerson; x: number; y: number; w: number; h: number; ghost: boolean };
export type OrgLine = { x1: number; y1: number; x2: number; y2: number; ghost: boolean };
export type OrgLayout = { boxes: OrgBox[]; lines: OrgLine[]; headOfficeY: number; scale: number };

const BOX_W = 232;
const BOX_H = 84;
const GHOST_H = 34;
const GAP_Y = 22;
const SIDE_GAP = 46;
const TOP = 132;
const MARGIN = 24;

/** Ô "+ Thêm" giữ chỗ khi đang sửa: id dạng ghost:<khối>:<nhánh>. */
export const GHOST_PREFIX = "ghost:";
export const isGhost = (person: Pick<OrgPerson, "id">) => person.id.startsWith(GHOST_PREFIX);
export function ghostSlots(people: readonly OrgPerson[]): OrgPerson[] {
  const ghost = (section: OrgSection, branch: OrgPerson["branch"]): OrgPerson => ({ ...blankPerson(`${GHOST_PREFIX}${section}:${branch}`, section, branch), workerCount: null });
  const groups = people.filter((person) => person.branch === "group").length;
  return [ghost("office", "main"), ghost("office", "right"), ghost("site", "main"), ghost("site", "left"), ghost("site", "right"), ...(groups < ORG_MAX_GROUPS ? [ghost("site", "group")] : [])];
}

/**
 * Tính vị trí các ô và đường nối. Trục chính ở giữa (x = 505). Nhánh phải / trái của văn phòng nối vào trục
 * ngay dưới ô văn phòng cuối; nhánh của công trường nối ngang vào trục, ô thấp nhất nằm trên thanh ngang.
 * Quản lý nhóm xếp một hàng dưới thanh ngang, ô đầu ngay dưới trục, các ô sau sang phải (đủ chỗ thì dời trái).
 * Ô "+ Thêm" (ghost) thấp hơn và nằm ở chỗ ô kế tiếp sẽ xuất hiện. Sơ đồ quá cao thì thu nhỏ cả cụm (scale).
 */
export function layoutOrgChart(people: readonly OrgPerson[]): OrgLayout {
  const cx = 505;
  const hOf = (person: OrgPerson) => isGhost(person) ? GHOST_H : BOX_H;
  const pick = (section: OrgSection, branch: OrgPerson["branch"]) => people.filter((person) => person.section === section && person.branch === branch);
  const officeMain = pick("office", "main");
  const officeRight = pick("office", "right");
  const officeLeft = pick("office", "left");
  const siteMain = pick("site", "main");
  const siteLeft = pick("site", "left");
  const siteRight = pick("site", "right");
  const realGroups = people.filter((person) => person.branch === "group" && !isGhost(person)).slice(0, ORG_MAX_GROUPS);
  const groups = [...realGroups, ...people.filter((person) => person.branch === "group" && isGhost(person)).slice(0, 1)];
  const boxes: OrgBox[] = [];
  const lines: OrgLine[] = [];
  const push = (person: OrgPerson, x: number, y: number, w: number) => { const box = { person, x, y, w, h: hOf(person), ghost: isGhost(person) }; boxes.push(box); return box; };
  const line = (x1: number, y1: number, x2: number, y2: number, ghost = false) => { lines.push({ x1, y1, x2, y2, ghost }); };

  // Văn phòng: trục chính
  let y = TOP;
  let lastBottom = TOP - GAP_Y;
  let officeRealBottom = TOP;
  officeMain.forEach((person) => {
    const box = push(person, cx - BOX_W / 2, y, BOX_W);
    if (box.ghost) line(cx, lastBottom, cx, box.y, true); else officeRealBottom = box.y + box.h;
    lastBottom = box.y + box.h;
    y += box.h + GAP_Y;
  });
  // Nhánh văn phòng: xếp chồng cạnh trục, bắt đầu thấp hơn ô đầu nửa ô
  const realOfficeMain = officeMain.filter((person) => !isGhost(person)).length;
  const officeJoin = officeRealBottom + 14;
  const sideStart = TOP + (realOfficeMain > 1 ? BOX_H / 2 + GAP_Y : 0);
  const sideJoins: number[] = [];
  const officeSide = (list: OrgPerson[], dir: 1 | -1) => {
    let top = sideStart;
    list.forEach((person) => {
      const x = dir === 1 ? cx + BOX_W / 2 + SIDE_GAP + 20 : cx - BOX_W / 2 - SIDE_GAP - 20 - BOX_W;
      const box = push(person, x, top, BOX_W);
      top += box.h + GAP_Y;
      const edge = dir === 1 ? box.x : box.x + box.w;
      const elbow = edge - dir * 22;
      const mid = box.y + box.h / 2;
      const join = Math.max(officeJoin, mid);
      line(edge, mid, elbow, mid, box.ghost);
      line(elbow, mid, elbow, join, box.ghost);
      line(elbow, join, cx, join, box.ghost);
      if (!box.ghost) sideJoins.push(join);
    });
  };
  officeSide(officeRight, 1);
  officeSide(officeLeft, -1);
  const officeBottom = Math.max(lastBottom, ...boxes.map((box) => box.y + box.h), TOP);
  const headOfficeY = officeBottom + 18;

  // Công trường: trục chính
  const siteTop = headOfficeY + 22;
  y = siteTop;
  let siteBottom = siteTop - GAP_Y;
  let prevBottom = headOfficeY;
  siteMain.forEach((person) => {
    const box = push(person, cx - BOX_W / 2, y, BOX_W);
    if (box.ghost) line(cx, prevBottom, cx, box.y, true);
    prevBottom = box.y + box.h;
    siteBottom = box.y + box.h;
    y += box.h + GAP_Y;
  });
  // Nhánh công trường: ô cuối nằm trên thanh ngang, các ô trước xếp lên trên
  const stackAbove = (list: OrgPerson[]) => list.length ? list.slice(0, -1).reduce((sum, person) => sum + hOf(person) + GAP_Y, 0) + hOf(list[list.length - 1]!) / 2 : 0;
  const busY = Math.max(siteBottom + 34, siteTop + Math.max(stackAbove(siteLeft), stackAbove(siteRight)));
  const siteSide = (list: OrgPerson[], dir: 1 | -1) => {
    let bottom = busY + (list.length ? hOf(list[list.length - 1]!) / 2 : 0);
    [...list].reverse().forEach((person) => {
      const h = hOf(person);
      const x = dir === 1 ? cx + BOX_W / 2 + SIDE_GAP + 20 : Math.max(MARGIN + 50, cx - BOX_W / 2 - SIDE_GAP - 50 - BOX_W);
      const box = push(person, x, bottom - h, BOX_W);
      bottom -= h + GAP_Y;
      const mid = box.y + box.h / 2;
      line(dir === 1 ? box.x : box.x + box.w, mid, cx, mid, box.ghost);
    });
  };
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
  const groupBoxes = groups.map((person, index) => push(person, gx + index * (gw + gap), groupTop, gw));

  // Trục dọc: từ ô văn phòng đầu tới thanh ngang (hoặc ô công trường cuối thật)
  const realSite = siteMain.filter((person) => !isGhost(person)).length;
  const realSides = [...siteLeft, ...siteRight].filter((person) => !isGhost(person)).length;
  const trunkTop = realOfficeMain ? TOP + BOX_H : headOfficeY;
  const realSiteBottom = realSite ? siteTop + realSite * (BOX_H + GAP_Y) - GAP_Y : headOfficeY;
  const trunkBottom = realGroups.length || realSides ? busY : realSiteBottom;
  const deepest = Math.max(trunkBottom, ...sideJoins);
  if (deepest > trunkTop) line(cx, trunkTop, cx, deepest);
  if (!realGroups.length && !realSides && groupBoxes.length) line(cx, realSiteBottom, cx, busY, true);
  // Thanh ngang công trường và nhánh xuống từng nhóm
  groupBoxes.forEach((box) => {
    const center = box.x + box.w / 2;
    line(Math.min(cx, center), busY, Math.max(cx, center), busY, box.ghost);
    line(center, busY, center, groupTop, box.ghost);
  });

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
