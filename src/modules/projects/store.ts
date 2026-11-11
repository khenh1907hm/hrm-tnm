import type { OrgChart } from "./orgChart";
import type {
  Holiday, LaborRate, LaborSettings, MemberRate, PeriodLock, Project, ProjectBudget, ProjectExpense, ProjectFinance, ProjectInput, ProjectMember,
  Subcontract, SubcontractPayment, Timesheet, TimesheetCost,
} from "./types";
import type { AttendanceCheck, AttendanceContext, GpsFix } from "./attendance";
import type { MonthRecord } from "./attendanceMonth";
import type { AttendanceRequest, RequestInput } from "./attendanceRequests";
import type { OtherHours } from "./timesheetRules";

/**
 * Nguồn dữ liệu phân hệ dự án. Hai bản: bộ nhớ (chế độ demo, lưu localStorage) và Supabase (RLS + hàm duyệt ở máy chủ).
 * Hàm đọc dữ liệu tiền trả null khi người xem không có quyền xem tiền.
 * Lỗi nghiệp vụ ném Error có message bắt đầu bằng mã (vd "TS_DAY_OVER_24:Nguyễn Văn A"), xem errorCode().
 */
export interface ProjectStore {
  readonly mode: "demo" | "live";
  /** Mã nhân sự gắn với tài khoản đang đăng nhập (null nếu chưa liên kết). */
  myEmployeeId(): Promise<string | null>;

  listProjects(): Promise<Project[]>;
  saveProject(input: ProjectInput & { id?: string }): Promise<Project>;
  getBudgets(projectId: string): Promise<ProjectBudget[] | null>;
  saveBudgets(projectId: string, budgets: readonly ProjectBudget[], reason: string): Promise<void>;

  listMembers(projectId: string): Promise<ProjectMember[]>;
  /** Mọi dự án có người này (để biết tài khoản đang đăng nhập làm tổ trưởng ở đâu). */
  listMembershipsOf(employeeId: string): Promise<ProjectMember[]>;
  saveMember(member: Omit<ProjectMember, "id"> & { id?: string }): Promise<ProjectMember>;
  removeMember(id: string): Promise<void>;
  listMemberRates(projectId: string): Promise<MemberRate[] | null>;
  setMemberRate(memberId: string, hourlyRate: number | null): Promise<void>;

  listRates(): Promise<LaborRate[] | null>;
  /** Ghi các dòng đơn giá đã đổi (thêm mới, hoặc đóng khoảng cũ). */
  upsertRates(rates: readonly LaborRate[]): Promise<void>;
  deleteRate(id: string): Promise<void>;
  getSettings(): Promise<LaborSettings>;
  saveSettings(settings: LaborSettings): Promise<void>;
  listHolidays(): Promise<Holiday[]>;
  saveHoliday(holiday: Holiday): Promise<void>;
  deleteHoliday(day: string): Promise<void>;

  listTimesheets(projectId: string, from: string, to: string): Promise<Timesheet[]>;
  /** Lưu phiếu nháp (tạo mới hoặc thay toàn bộ dòng công). */
  saveTimesheet(sheet: Timesheet): Promise<Timesheet>;
  deleteTimesheet(id: string): Promise<void>;
  submitTimesheet(id: string): Promise<void>;
  approveTimesheet(id: string): Promise<void>;
  rejectTimesheet(id: string, reason: string): Promise<void>;
  reopenTimesheet(id: string, reason: string): Promise<void>;
  /** Giờ công ở các phiếu khác đã gửi hoặc đã duyệt của những người này trong khoảng ngày, phạm vi người xem đọc được. */
  otherHours(employeeIds: readonly string[], from: string, to: string, excludeTimesheetId: string): Promise<OtherHours[]>;
  listCosts(projectId: string, from: string, to: string): Promise<TimesheetCost[] | null>;
  recalcCosts(projectId: string, from: string, to: string): Promise<number>;

  listSubcontracts(projectId: string): Promise<Subcontract[]>;
  saveSubcontract(item: Omit<Subcontract, "id"> & { id?: string }): Promise<Subcontract>;
  deleteSubcontract(id: string): Promise<void>;
  listPayments(projectId: string): Promise<SubcontractPayment[] | null>;
  savePayment(item: Omit<SubcontractPayment, "id"> & { id?: string }): Promise<void>;
  deletePayment(id: string): Promise<void>;
  listExpenses(projectId: string): Promise<ProjectExpense[] | null>;
  saveExpense(item: Omit<ProjectExpense, "id"> & { id?: string }): Promise<void>;
  deleteExpense(id: string): Promise<void>;

  /** Vốn dự án; null khi người xem không được xem tiền hoặc chưa nhập. */
  getFinance(projectId: string): Promise<ProjectFinance | null>;
  saveFinance(projectId: string, finance: ProjectFinance): Promise<void>;

  /** Sơ đồ tổ chức nhà thầu phụ (BH-02-F02); null khi chưa lập. */
  getOrgChart(projectId: string): Promise<OrgChart | null>;
  saveOrgChart(projectId: string, chart: OrgChart): Promise<void>;
  /** Mẫu chung của công ty (tiêu đề + khối Văn phòng) để sơ đồ mới của mọi dự án dùng lại. */
  getOrgTemplate(): Promise<OrgChart | null>;
  saveOrgTemplate(template: OrgChart): Promise<void>;

  /** Dự án đang thi công mà người đăng nhập là thành viên (để tự chấm công). */
  myAttendance(): Promise<AttendanceContext[]>;
  /** Tự chấm Vào / Ra: tải ảnh lên rồi gọi máy chủ kiểm tra vị trí (ngoài bán kính ném CHECKIN_OUT_OF_RANGE:<mét>). */
  checkIn(projectId: string, position: GpsFix, photo: Blob): Promise<void>;
  checkOut(projectId: string, position: GpsFix, photo: Blob): Promise<void>;
  /** Lượt chấm công GPS của dự án trong khoảng ngày (phạm vi người xem đọc được). */
  listChecks(projectId: string, from: string, to: string): Promise<AttendanceCheck[]>;
  /** Đường dẫn xem ảnh chấm công (link có hạn); null nếu không xem được. */
  photoUrl(path: string): Promise<string | null>;
  /** Lịch chấm công tháng YYYY-MM của chính người đăng nhập (hàm my_attendance_month). */
  myMonth(month: string): Promise<MonthRecord[]>;
  /** Phiếu giải trình người xem đọc được (của mình; PM, CHT: của dự án; sếp: tất cả); lọc theo dự án nếu có. */
  listRequests(projectId?: string): Promise<AttendanceRequest[]>;
  submitRequest(input: RequestInput): Promise<void>;
  cancelRequest(id: string): Promise<void>;
  reviewRequest(id: string, approve: boolean, note: string): Promise<void>;
  /** Chỉ bản demo: xem thử như một nhân viên (để thử tự chấm công). */
  actAs?(employeeId: string | null): void;

  listLocks(projectId: string): Promise<PeriodLock[]>;
  lockMonth(projectId: string, month: string): Promise<void>;
  unlockMonth(projectId: string, month: string, reason: string): Promise<void>;
}

/** Tách mã lỗi và phần chi tiết từ lỗi do store ném ra ("TS_DAY_OVER_24:Nguyễn Văn A"). */
export function errorCode(error: unknown): { code: string; detail: string } {
  const message = error instanceof Error ? error.message : String(error);
  const match = /\b([A-Z][A-Z0-9_]{2,})(?::(.*))?$/.exec(message.trim());
  return match ? { code: match[1]!, detail: (match[2] ?? "").trim() } : { code: "PROJECT_SAVE_FAILED", detail: message };
}
