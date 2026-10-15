import type { SupabaseClient } from "@supabase/supabase-js";

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { message: string } | null };

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * Supabase giả lập trong bộ nhớ, chỉ đủ các thao tác repository dùng:
 * select/eq/order/maybeSingle/single, insert, update…select, delete…select và rpc renew_certificate.
 * Dữ liệu đi qua JSON như khi gửi lên máy chủ thật.
 */
export function createFakeSupabase(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = Object.fromEntries(Object.entries(seed).map(([name, rows]) => [name, clone(rows)]));
  let clock = 0;
  const table = (name: string) => (tables[name] ??= []);

  class Query implements PromiseLike<Result> {
    private op: "select" | "insert" | "update" | "delete" = "select";
    private columns = "*";
    private filters: [string, unknown][] = [];
    private sort: [string, boolean] | null = null;
    private mode: "many" | "maybe" | "single" = "many";
    private returning = false;
    private payload: Row = {};
    constructor(private readonly name: string) {}

    select(columns = "*") { if (this.op === "select") this.columns = columns; else this.returning = true; return this; }
    eq(column: string, value: unknown) { this.filters.push([column, value]); return this; }
    order(column: string, options: { ascending: boolean }) { this.sort = [column, options.ascending]; return this; }
    maybeSingle() { this.mode = "maybe"; return this; }
    single() { this.mode = "single"; return this; }
    insert(payload: Row) { this.op = "insert"; this.payload = clone(payload); return this; }
    update(payload: Row) { this.op = "update"; this.payload = clone(payload); return this; }
    delete() { this.op = "delete"; return this; }

    then<A = Result, B = never>(resolve?: ((value: Result) => A | PromiseLike<A>) | null, reject?: ((reason: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
      return Promise.resolve(this.run()).then(resolve, reject);
    }

    private run(): Result {
      if (this.name === "broken") return { data: null, error: { message: "bảng hỏng" } };
      const rows = table(this.name);
      const matched = rows.filter((row) => this.filters.every(([column, value]) => row[column] === value));
      if (this.op === "insert") {
        if (rows.some((row) => row.id !== undefined && row.id === this.payload.id) || rows.some((row) => row.identity !== undefined && row.identity === this.payload.identity)) return { data: null, error: { message: "duplicate key" } };
        rows.push({ created_at: ++clock, ...this.payload });
        return { data: null, error: null };
      }
      if (this.op === "update") {
        matched.forEach((row) => Object.assign(row, clone(this.payload)));
        return { data: this.returning ? matched.map((row) => ({ id: row.id })) : null, error: null };
      }
      if (this.op === "delete") {
        tables[this.name] = rows.filter((row) => !matched.includes(row));
        return { data: this.returning ? matched.map((row) => ({ id: row.id })) : null, error: null };
      }
      const sorted = this.sort ? [...matched].sort((a, b) => (a[this.sort![0]]! < b[this.sort![0]]! ? -1 : 1) * (this.sort![1] ? 1 : -1)) : matched;
      const keys = this.columns === "*" ? null : this.columns.split(",").map((key) => key.trim());
      const projected = sorted.map((row) => clone(keys ? Object.fromEntries(keys.map((key) => [key, row[key]])) : row));
      if (this.mode === "many") return { data: projected, error: null };
      if (this.mode === "single" && projected.length !== 1) return { data: null, error: { message: "not exactly one row" } };
      return { data: projected[0] ?? null, error: null };
    }
  }

  const client = {
    from: (name: string) => new Query(name),
    rpc: async (name: string, args: { p_old_id: string; p_expected_version: number; p_old: Row; p_new: Row }): Promise<Result> => {
      if (name !== "renew_certificate") return { data: null, error: { message: `không có hàm ${name}` } };
      const rows = table("certificates");
      const old = rows.find((row) => row.id === args.p_old_id && row.version === args.p_expected_version);
      if (!old) return { data: false, error: null };
      Object.assign(old, { version: args.p_old.version, state: args.p_old.state, expiry_date: args.p_old.expiryDate, doc: clone(args.p_old) });
      rows.push({ created_at: ++clock, id: args.p_new.id, version: args.p_new.version, employee_id: args.p_new.employeeId, type: args.p_new.type, state: args.p_new.state, expiry_date: args.p_new.expiryDate, doc: clone(args.p_new) });
      return { data: true, error: null };
    },
  };
  return { client: client as unknown as SupabaseClient, tables };
}
