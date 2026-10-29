import { describe, expect, it, vi } from "vitest";
import type { AuditEvent } from "../modules/audit/types";
import { handleAccountRequest, type Account, type AccountDeps, type AccountStore } from "./accountAdmin";

const env = { supabaseUrl: "https://example.supabase.co", supabaseKey: "publishable" };
const userFetch = (id: string | null) => vi.fn(async () => id ? new Response(JSON.stringify({ id }), { status: 200 }) : new Response("{}", { status: 401 })) as unknown as typeof fetch;
const request = (method: string, body?: unknown, authorization = "Bearer user-jwt") => new Request("http://localhost/api/admin/accounts", { method, headers: { authorization, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

const account = (overrides: Partial<Account> = {}): Account => ({ id: "u2", email: "hr@tnm.vn", fullName: "Lan", role: "hr", createdAt: "2026-10-01T00:00:00Z", lastSignInAt: null, locked: false, ...overrides });

function memoryStore(initial: Account[] = [account({ id: "admin1", email: "admin@tnm.vn", role: "admin" }), account()]) {
  const accounts = new Map(initial.map((item) => [item.id, item]));
  const audit: AuditEvent[] = [];
  const passwords = new Map<string, string>();
  const store: AccountStore = {
    list: async () => [...accounts.values()],
    get: async (id) => accounts.get(id) ?? null,
    create: async (input) => {
      if ([...accounts.values()].some((item) => item.email === input.email)) return { ok: false, code: "ACCOUNT_EMAIL_TAKEN" };
      const created = account({ id: `new-${accounts.size}`, email: input.email, fullName: input.fullName, role: input.role });
      accounts.set(created.id, created);
      passwords.set(created.id, input.password);
      return { ok: true, account: created };
    },
    update: async (change) => {
      const current = accounts.get(change.id)!;
      accounts.set(change.id, { ...current, ...(change.role ? { role: change.role } : {}), ...(change.fullName !== undefined ? { fullName: change.fullName } : {}), ...(change.locked !== undefined ? { locked: change.locked } : {}) });
      if (change.password) passwords.set(change.id, change.password);
    },
    appendAudit: async (event) => { audit.push(event); },
  };
  return { store, accounts, audit, passwords };
}

function deps(store: AccountStore | null, overrides: Partial<AccountDeps> = {}): AccountDeps {
  const roles: Record<string, string> = { admin1: "admin", u2: "hr" };
  return { lookupRole: async (id) => roles[id] ?? null, store, fetcher: userFetch("admin1"), now: () => "2026-10-29T08:00:00Z", newId: () => "evt", ...overrides };
}

describe("handleAccountRequest", () => {
  it("ACC_01 chỉ Admin đã đăng nhập được xem và sửa tài khoản", async () => {
    const { store } = memoryStore();
    expect((await handleAccountRequest(request("GET", undefined, ""), env, deps(store))).status).toBe(401);
    expect((await handleAccountRequest(request("GET"), env, deps(store, { fetcher: userFetch(null) }))).status).toBe(401);
    expect((await handleAccountRequest(request("GET"), env, deps(store, { fetcher: userFetch("u2") }))).status).toBe(401);
    expect((await handleAccountRequest(request("PATCH", { id: "u2", role: "admin" }), env, deps(store, { fetcher: userFetch("u2") }))).status).toBe(401);
    const response = await handleAccountRequest(request("GET"), env, deps(store));
    expect(response.status).toBe(200);
    expect((await response.json() as { accounts: Account[] }).accounts.map((item) => item.email)).toEqual(["admin@tnm.vn", "hr@tnm.vn"]);
  });

  it("báo chưa cấu hình khi máy chủ thiếu khóa bí mật", async () => {
    expect((await handleAccountRequest(request("GET"), env, deps(null))).status).toBe(503);
  });

  it("ACC_02 thêm tài khoản: email hợp lệ, mật khẩu từ 8 ký tự, vai trò có trong danh sách, email không trùng", async () => {
    const { store, accounts, passwords } = memoryStore();
    const post = (body: unknown) => handleAccountRequest(request("POST", body), env, deps(store));
    expect(await (await post({ email: "sai", password: "12345678", role: "hr" })).json()).toMatchObject({ code: "ACCOUNT_EMAIL_INVALID" });
    expect(await (await post({ email: "a@tnm.vn", password: "1234567", role: "hr" })).json()).toMatchObject({ code: "ACCOUNT_PASSWORD_SHORT" });
    expect(await (await post({ email: "a@tnm.vn", password: "12345678", role: "boss" })).json()).toMatchObject({ code: "ACCOUNT_ROLE_INVALID" });
    expect((await post({ email: "HR@tnm.vn", password: "12345678", role: "hr" })).status).toBe(409);
    const created = await post({ email: " KySu@TNM.vn ", password: "12345678", fullName: " Minh ", role: "engineer" });
    expect(created.status).toBe(200);
    const value = (await created.json() as { account: Account }).account;
    expect(value).toMatchObject({ email: "kysu@tnm.vn", fullName: "Minh", role: "engineer" });
    expect(accounts.get(value.id)?.role).toBe("engineer");
    expect(passwords.get(value.id)).toBe("12345678");
  });

  it("ACC_03 Admin không tự hạ vai trò hay tự khóa tài khoản của mình", async () => {
    const { store, accounts } = memoryStore();
    const patch = (body: unknown) => handleAccountRequest(request("PATCH", body), env, deps(store));
    expect(await (await patch({ id: "admin1", role: "hr" })).json()).toMatchObject({ code: "ACCOUNT_SELF_LOCKOUT" });
    expect(await (await patch({ id: "admin1", locked: true })).json()).toMatchObject({ code: "ACCOUNT_SELF_LOCKOUT" });
    expect(accounts.get("admin1")).toMatchObject({ role: "admin", locked: false });
    expect((await patch({ id: "admin1", fullName: "Quản trị", password: "matkhaumoi" })).status).toBe(200);
    expect((await patch({ id: "u2", role: "admin", locked: true })).status).toBe(200);
    expect(accounts.get("u2")).toMatchObject({ role: "admin", locked: true });
    expect((await patch({ id: "khong-co", role: "hr" })).status).toBe(404);
  });

  it("ACC_04 mọi thay đổi tài khoản ghi nhật ký dưới tên Admin, không bao giờ chứa mật khẩu", async () => {
    const { store, audit } = memoryStore();
    await handleAccountRequest(request("POST", { email: "moi@tnm.vn", password: "bimat123", role: "hr" }), env, deps(store));
    await handleAccountRequest(request("PATCH", { id: "u2", role: "employee", locked: true, password: "bimat456" }), env, deps(store));
    await handleAccountRequest(request("PATCH", { id: "u2", role: "employee" }), env, deps(store));
    expect(audit.map((event) => event.action)).toEqual(["account.create", "account.role", "account.lock", "account.password"]);
    expect(audit.every((event) => event.entityType === "account" && event.actorId === "admin1" && event.role === "admin")).toBe(true);
    expect(audit[1]).toMatchObject({ before: { role: "hr" }, after: { role: "employee" } });
    expect(JSON.stringify(audit)).not.toMatch(/bimat/);
  });
});
