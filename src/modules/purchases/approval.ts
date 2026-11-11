/**
 * Chuỗi ký theo bộ phận dùng chung cho ngân sách (P-COST-03) và đơn đặt hàng nháp (P-CC-07).
 * Đặc tả: docs/dac-ta-mua-hang-du-an.md mục 2.1, 3.5, quy tắc PRC-04.
 */
export type Department = "technical" | "material" | "accounting" | "leader" | "admin_office";
export type ApprovalRole = "pic" | Department;
export const DEPARTMENTS: readonly Department[] = ["leader", "technical", "material", "accounting", "admin_office"];
export const ROLE_LABELS: Record<ApprovalRole, string> = {
  pic: "Phụ trách", technical: "P. Kỹ thuật", material: "P. Vật tư", accounting: "Kế toán", leader: "Lãnh đạo", admin_office: "Hành chánh",
};
export type ApprovalDocType = "budget" | "purchase" | "payment";
/** Thứ tự ký theo ô ký trên mẫu: ngân sách 3 người; đơn nháp 6 người (Lãnh đạo duyệt, Hành chánh nhận để phát hành PO). */
export const CHAINS: Record<ApprovalDocType, readonly ApprovalRole[]> = {
  budget: ["pic", "technical", "leader"],
  purchase: ["pic", "technical", "material", "accounting", "leader", "admin_office"],
  /** Đề nghị tạm ứng / thanh toán (P-CF-03): Lãnh đạo ký xong thì Kế toán chi. */
  payment: ["pic", "technical", "material", "leader"],
};
/**
 * Ngày mục tiêu theo mẫu (ngày làm việc thứ mấy kể từ ngày gửi), không cộng dồn từng bước:
 *  - P-CC-07: Phụ trách, P. Kỹ thuật ngày 1; P. Vật tư ngày 2; Kế toán, Lãnh đạo, Hành chánh ngày 3 (mẫu ghi 01/01, 01/01, 02/01, 03/01…; sơ đồ tổng quan: nháp 1 ngày, duyệt 1 ngày, phát hành 1 ngày).
 *  - P-COST-03: sơ đồ tổng quan "Làm ngân sách 2 ngày": Phụ trách, P. Kỹ thuật ngày 1; Lãnh đạo ngày 2.
 *  - P-CF-03: "Đề nghị thanh toán 1 ngày, Duyệt 1 ngày": Phụ trách, P. Kỹ thuật, P. Vật tư ngày 1; Lãnh đạo ngày 2.
 */
export const TARGET_DAY: Record<ApprovalDocType, Partial<Record<ApprovalRole, number>>> = {
  budget: { pic: 1, technical: 1, leader: 2 },
  purchase: { pic: 1, technical: 1, material: 2, accounting: 3, leader: 3, admin_office: 3 },
  payment: { pic: 1, technical: 1, material: 1, leader: 2 },
};

/** Ngày làm việc thứ n sau ngày gửi. */
export function nthWorkday(from: string, n: number, holidays: ReadonlySet<string> = new Set()): string {
  let day = from;
  for (let i = 0; i < n; i++) day = nextWorkday(day, holidays);
  return day;
}

/** Bước quyết định: ký xong bước này thì phiếu được duyệt. */
export const DECIDING_ROLE: ApprovalRole = "leader";

/** Người thuộc từng bộ phận (mã hồ sơ nhân sự). Admin cấu hình. */
export type DepartmentMembers = Record<Department, string[]>;
export const emptyDepartments = (): DepartmentMembers => ({ leader: [], technical: [], material: [], accounting: [], admin_office: [] });

export type StepResult = "pending" | "signed" | "returned" | "skipped";
export type ApprovalStep = {
  id: string;
  docType: ApprovalDocType;
  docId: string;
  seq: number;
  role: ApprovalRole;
  targetDate: string;
  result: StepResult;
  signerName: string;
  note: string;
  actedAt: string | null;
};

const addDays = (iso: string, days: number) => { const date = new Date(`${iso}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); };

/** Ngày làm việc kế tiếp (bỏ Chủ nhật và ngày lễ). */
export function nextWorkday(iso: string, holidays: ReadonlySet<string> = new Set()): string {
  let day = addDays(iso, 1);
  while (new Date(`${day}T00:00:00Z`).getUTCDay() === 0 || holidays.has(day)) day = addDays(day, 1);
  return day;
}

/**
 * PRC-04: dựng chuỗi ký khi gửi. Ngày mục tiêu theo TARGET_DAY của mẫu (bỏ Chủ nhật, ngày lễ).
 * Bộ phận chưa có ai (và không phải Phụ trách) thì bỏ qua để chuỗi không bị kẹt.
 */
export function buildSteps(docType: ApprovalDocType, docId: string, submittedOn: string, departments: DepartmentMembers, newId: () => string, holidays: ReadonlySet<string> = new Set()): ApprovalStep[] {
  return CHAINS[docType].map((role, index) => {
    const skipped = role !== "pic" && !departments[role].length;
    const targetDate = nthWorkday(submittedOn, TARGET_DAY[docType][role] ?? index + 1, holidays);
    return { id: newId(), docType, docId, seq: index + 1, role, targetDate, result: skipped ? "skipped" : "pending", signerName: "", note: "", actedAt: null };
  });
}

/** Bước đang chờ ký (bước chưa ký đầu tiên), null khi đã xong hoặc đã bị trả về. */
export function currentStep(steps: readonly ApprovalStep[]): ApprovalStep | null {
  if (steps.some((step) => step.result === "returned")) return null;
  return [...steps].sort((a, b) => a.seq - b.seq).find((step) => step.result === "pending") ?? null;
}

export type Signer = { employeeId: string | null; isAdmin: boolean; isPicOfDoc: boolean; departments: DepartmentMembers; isPurchaseApprover?: boolean };

/** Người này có thuộc vai trò của bước không (Admin ký thay được mọi bước). */
export function holdsRole(role: ApprovalRole, me: Signer): boolean {
  if (me.isAdmin) return true;
  if (role === "pic") return me.isPicOfDoc;
  if (role === "leader" && me.isPurchaseApprover) return true;
  return me.employeeId !== null && me.departments[role].includes(me.employeeId);
}

/** PRC-04: chỉ ký được bước đang chờ, và phải giữ vai trò của bước đó. */
export const canSign = (steps: readonly ApprovalStep[], me: Signer) => { const step = currentStep(steps); return step !== null && holdsRole(step.role, me); };

/** Đã qua bước quyết định (Lãnh đạo ký) chưa. */
export const isDecided = (steps: readonly ApprovalStep[]) => steps.some((step) => step.role === DECIDING_ROLE && step.result === "signed");

/** Quá hạn: bước đang chờ đã qua ngày mục tiêu. */
export const isOverdue = (step: ApprovalStep, today: string) => step.result === "pending" && step.targetDate < today;
