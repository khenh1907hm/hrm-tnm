import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Account, AccountRole, AccountStore } from "./accountAdmin";
import { ACCOUNT_ROLES } from "./accountAdmin";

/** Khóa "vĩnh viễn" (100 năm) theo cách Supabase Auth hiểu ban_duration. */
const LOCK_DURATION = "876000h";
type ProfileRow = { id: string; role: string; full_name: string };

const roleOf = (raw: string | undefined): AccountRole => ACCOUNT_ROLES.includes(raw as AccountRole) ? raw as AccountRole : "pending";
const toAccount = (user: User, profile: ProfileRow | undefined): Account => {
  const bannedUntil = (user as User & { banned_until?: string | null }).banned_until;
  return {
    id: user.id,
    email: user.email ?? "",
    fullName: profile?.full_name ?? "",
    role: roleOf(profile?.role),
    createdAt: user.created_at,
    lastSignInAt: user.last_sign_in_at ?? null,
    locked: Boolean(bannedUntil && Date.parse(bannedUntil) > Date.now()),
  };
};

function check<T extends { error: { message: string } | null }>(result: T): T {
  if (result.error) throw new Error(result.error.message);
  return result;
}

/** Kho tài khoản trên Supabase Auth + bảng profiles; client phải dùng khóa bí mật (bỏ qua RLS). */
export function createSupabaseAccountStore(admin: SupabaseClient): AccountStore {
  const profilesById = async (ids?: string[]) => {
    let query = admin.from("profiles").select("id, role, full_name");
    if (ids) query = query.in("id", ids);
    const { data } = check(await query);
    return new Map((data as ProfileRow[] | null ?? []).map((row) => [row.id, row]));
  };

  return {
    async list() {
      const users: User[] = [];
      for (let page = 1; ; page++) {
        const { data } = check(await admin.auth.admin.listUsers({ page, perPage: 1000 }));
        users.push(...data.users);
        if (data.users.length < 1000) break;
      }
      const profiles = await profilesById();
      return users.map((user) => toAccount(user, profiles.get(user.id))).sort((a, b) => a.email.localeCompare(b.email));
    },
    async get(id) {
      const { data, error } = await admin.auth.admin.getUserById(id);
      if (error || !data.user) return null;
      return toAccount(data.user, (await profilesById([id])).get(id));
    },
    async create(input) {
      const { data, error } = await admin.auth.admin.createUser({ email: input.email, password: input.password, email_confirm: true, user_metadata: { full_name: input.fullName } });
      if (error) {
        if (error.code === "email_exists" || /already (been )?registered/i.test(error.message)) return { ok: false, code: "ACCOUNT_EMAIL_TAKEN" };
        throw new Error(error.message);
      }
      // Trigger handle_new_user đã tạo dòng profiles (vai trò pending); gán vai trò admin chọn
      check(await admin.from("profiles").upsert({ id: data.user.id, role: input.role, full_name: input.fullName }));
      return { ok: true, account: toAccount(data.user, { id: data.user.id, role: input.role, full_name: input.fullName }) };
    },
    async update(change) {
      const profile: Partial<ProfileRow> = {};
      if (change.role !== undefined) profile.role = change.role;
      if (change.fullName !== undefined) profile.full_name = change.fullName;
      if (Object.keys(profile).length) check(await admin.from("profiles").update(profile).eq("id", change.id));
      if (change.password !== undefined || change.locked !== undefined) {
        check(await admin.auth.admin.updateUserById(change.id, {
          ...(change.password !== undefined ? { password: change.password } : {}),
          ...(change.locked !== undefined ? { ban_duration: change.locked ? LOCK_DURATION : "none" } : {}),
        }));
      }
    },
    async appendAudit(event) {
      check(await admin.from("audit_events").insert({ id: event.id, at: event.at, actor_id: event.actorId, action: event.action, entity_type: event.entityType, entity_id: event.entityId, doc: event }));
    },
  };
}
