/** Kiểu dữ liệu phân hệ quản lý dự án (docs/dac-ta-quan-ly-du-an.md). Tiền là VNĐ số nguyên; ngày dạng YYYY-MM-DD. */

export type BudgetCategory = "labor" | "subcontract" | "material" | "other";
export const BUDGET_CATEGORIES: readonly BudgetCategory[] = ["labor", "subcontract", "material", "other"];
export const BUDGET_CATEGORY_LABELS: Record<BudgetCategory, string> = {
  labor: "Nhân công",
  subcontract: "Thầu phụ / thời vụ",
  material: "Vật tư",
  other: "Chi phí khác",
};

export type ProjectStatus = "planning" | "active" | "paused" | "done" | "archived";
export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  planning: "Lập kế hoạch",
  active: "Đang thi công",
  paused: "Tạm dừng",
  done: "Hoàn thành",
  archived: "Lưu trữ",
};

export type Project = {
  id: string;
  code: string;
  name: string;
  customerId: string | null;
  customerName: string;
  site: string;
  pmEmployeeId: string | null;
  plannedStart: string;
  plannedEnd: string;
  actualStart: string | null;
  actualEnd: string | null;
  /** Giờ chuẩn mỗi ngày (mặc định 8). */
  stdHours: number;
  /** Ngày nghỉ trong tuần: 0 = Chủ nhật … 6 = Thứ bảy. */
  weeklyOff: number[];
  status: ProjectStatus;
  note: string;
  updatedAt: string;
};

export type ProjectInput = Omit<Project, "id" | "updatedAt">;

export type ProjectBudget = { category: BudgetCategory; amount: number; warnPct: number; plannedHours: number | null };

export type MemberRole = "pm" | "commander" | "supervisor" | "engineer" | "leader" | "worker";
export const MEMBER_ROLE_LABELS: Record<MemberRole, string> = {
  pm: "PM",
  commander: "Chỉ huy trưởng",
  supervisor: "Giám sát",
  engineer: "Kỹ sư",
  leader: "Tổ trưởng",
  worker: "Tổ viên",
};
export const MEMBER_ROLES = Object.keys(MEMBER_ROLE_LABELS) as MemberRole[];

export type ProjectMember = {
  id: string;
  projectId: string;
  employeeId: string;
  displayName: string;
  employeeCode: string;
  role: MemberRole;
  /** Quản lý trực tiếp trong dự án (null = gốc cây). */
  parentId: string | null;
  team: string;
  /** Có giá trị nghĩa là người của thầu phụ → tiền tính vào khoản thầu phụ. */
  subcontractId: string | null;
  joinedOn: string;
  leftOn: string | null;
};

export type LaborRate = { id: string; employeeId: string; hourlyRate: number; effectiveFrom: string; effectiveTo: string | null; note: string };
/** Đơn giá riêng của một thành viên trong dự án (ưu tiên hơn đơn giá chung). */
export type MemberRate = { memberId: string; hourlyRate: number };

export type LaborSettings = {
  otWeekday: number;
  otWeeklyOff: number;
  otHoliday: number;
  nightBonus: number;
  maxHoursDay: number;
  maxOtMonth: number;
  maxOtYear: number;
  backfillDays: number;
};
/** Mặc định theo Điều 98 và Điều 107 Bộ luật Lao động 2019. */
export const DEFAULT_LABOR_SETTINGS: LaborSettings = { otWeekday: 1.5, otWeeklyOff: 2, otHoliday: 3, nightBonus: 0.3, maxHoursDay: 12, maxOtMonth: 40, maxOtYear: 200, backfillDays: 3 };

export type Holiday = { day: string; name: string };

export type Attendance = "present" | "leave" | "absent" | "holiday";
export const ATTENDANCE_LABELS: Record<Attendance, string> = { present: "Có mặt", leave: "Vắng có phép", absent: "Vắng không phép", holiday: "Nghỉ lễ" };
export type OtType = "weekday" | "weekly_off" | "holiday";
export const OT_TYPE_LABELS: Record<OtType, string> = { weekday: "Ngày thường", weekly_off: "Ngày nghỉ tuần", holiday: "Ngày lễ" };

export type TimesheetStatus = "draft" | "submitted" | "approved" | "rejected";
export const TIMESHEET_STATUS_LABELS: Record<TimesheetStatus, string> = { draft: "Nháp", submitted: "Chờ duyệt", approved: "Đã duyệt", rejected: "Bị từ chối" };

export type TimesheetLine = {
  id: string;
  employeeId: string;
  attendance: Attendance;
  regularHours: number;
  otHours: number;
  otType: OtType;
  nightHours: number;
  note: string;
};

export type Timesheet = {
  id: string;
  projectId: string;
  workDate: string;
  team: string;
  status: TimesheetStatus;
  submittedAt: string | null;
  approvedAt: string | null;
  rejectReason: string;
  lines: TimesheetLine[];
};

export type CostCategory = "labor" | "subcontract";
export type TimesheetCost = {
  lineId: string;
  projectId: string;
  workDate: string;
  employeeId: string;
  category: CostCategory;
  /** null = thiếu đơn giá (amount = 0). */
  rate: number | null;
  otMultiplier: number;
  nightBonus: number;
  amount: number;
};

export type SubcontractMode = "timesheet" | "lump_sum";
export type Subcontract = { id: string; projectId: string; partnerId: string | null; name: string; mode: SubcontractMode; contractNo: string; contractValue: number; signedOn: string | null; note: string };
export type PaymentStatus = "requested" | "approved" | "paid";
export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = { requested: "Đề nghị", approved: "Đã duyệt", paid: "Đã chi" };
export type SubcontractPayment = { id: string; subcontractId: string; payDate: string; amount: number; status: PaymentStatus; note: string };

export type ExpenseCategory = "material" | "other";
export type ProjectExpense = { id: string; projectId: string; spentOn: string; category: ExpenseCategory; description: string; supplier: string; amount: number; status: "draft" | "approved" };

/** Tháng đã khóa sổ, dạng YYYY-MM. */
export type PeriodLock = { projectId: string; month: string; lockedAt: string };
