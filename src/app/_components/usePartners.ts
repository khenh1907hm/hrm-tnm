import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sortPartners, validatePartner, type Partner } from "../../modules/partners/types";

const DEMO_KEY = "tnm-hrm:partners";

function readDemo(): Partner[] {
  try { const raw = window.localStorage.getItem(DEMO_KEY); return raw ? JSON.parse(raw) as Partner[] : []; } catch { return []; }
}
function writeDemo(partners: readonly Partner[]) {
  try { window.localStorage.setItem(DEMO_KEY, JSON.stringify(partners)); } catch { /* trình duyệt chặn lưu: vẫn dùng được trong phiên */ }
}

async function fetchPartners(client: SupabaseClient | null): Promise<{ partners: Partner[] } | { error: string }> {
  if (!client) return { partners: sortPartners(readDemo()) };
  const { data, error } = await client.from("partners").select("id, name, image").order("name", { ascending: true });
  return error ? { error: error.message } : { partners: sortPartners((data ?? []) as Partner[]) };
}

/**
 * Danh sách đối tác: bảng `partners` (chế độ thật) hoặc localStorage (chế độ demo).
 * `save`/`remove` trả về thông báo lỗi tiếng Việt, hoặc null khi thành công.
 */
export function usePartners(client: SupabaseClient | null, onError: (message: string) => void = () => undefined) {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [loaded, setLoaded] = useState(false);

  const apply = useCallback((result: { partners: Partner[] } | { error: string }) => {
    setLoaded(true);
    if ("error" in result) onError(`Không tải được danh sách đối tác: ${result.error}`);
    else setPartners(result.partners);
  }, [onError]);
  const reload = useCallback(async () => apply(await fetchPartners(client)), [client, apply]);

  useEffect(() => {
    let active = true;
    void fetchPartners(client).then((result) => { if (active) apply(result); });
    return () => { active = false; };
  }, [client, apply]);

  const save = useCallback(async (input: { id?: string; name: string; image: string }): Promise<string | null> => {
    const problem = validatePartner(input, partners);
    if (problem) return problem;
    const name = input.name.trim();
    if (!client) {
      const next = input.id
        ? partners.map((partner) => partner.id === input.id ? { ...partner, name, image: input.image } : partner)
        : [...partners, { id: crypto.randomUUID(), name, image: input.image }];
      writeDemo(next);
      setPartners(sortPartners(next));
      return null;
    }
    const { error } = input.id
      ? await client.from("partners").update({ name, image: input.image }).eq("id", input.id)
      : await client.from("partners").insert({ name, image: input.image });
    if (error) return error.code === "23505" ? "Đã có đối tác cùng tên." : `Không lưu được đối tác: ${error.message}`;
    await reload();
    return null;
  }, [client, partners, reload]);

  const remove = useCallback(async (id: string): Promise<string | null> => {
    if (!client) {
      const next = partners.filter((partner) => partner.id !== id);
      writeDemo(next);
      setPartners(next);
      return null;
    }
    const { error } = await client.from("partners").delete().eq("id", id);
    if (error) return `Không xóa được đối tác: ${error.message}`;
    await reload();
    return null;
  }, [client, partners, reload]);

  return { partners, loaded, save, remove };
}

export type PartnerStore = ReturnType<typeof usePartners>;
