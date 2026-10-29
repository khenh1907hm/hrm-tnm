import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase } from "../../repositories/supabase/fakeSupabase";
import { DEFAULT_CERTIFICATE_FOLDER_PRESET, type CertificateFolderPreset } from "../../modules/excel-template/certificateFolderPresets";
import { loadPresets, PRESET_ROW_ID } from "./certificateFolderPresetStore";

const LOCAL_KEY = "tnm-hrm:certificate-folder-presets";
const preset = (id: string, name: string): CertificateFolderPreset => ({ ...DEFAULT_CERTIFICATE_FOLDER_PRESET, id, name, typeKeys: ["atld"], employeeFolderPattern: "Vinci - {mã nhân viên}" });
let storage: Map<string, string>;

beforeEach(() => {
  storage = new Map();
  vi.stubGlobal("window", { localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, value); } } });
});
afterEach(() => { vi.unstubAllGlobals(); });

const serverWith = (doc: unknown) => createFakeSupabase({ settings: [{ id: "global", version: 0, doc: {} }, { id: PRESET_ROW_ID, version: 0, doc }] });
const serverPresets = (fake: ReturnType<typeof createFakeSupabase>) => (fake.tables.settings!.find((row) => row.id === PRESET_ROW_ID)!.doc as { presets?: CertificateFolderPreset[] }).presets;

describe("cấu hình tải thư mục chứng chỉ dùng chung", () => {
  it("máy chủ còn trống: chép cấu hình đã cài trên trình duyệt lên, báo số cấu hình đã chép", async () => {
    storage.set(LOCAL_KEY, JSON.stringify([preset("vinci", "Vinci"), preset("kumho", "Kumho")]));
    const fake = serverWith({});
    const loaded = await loadPresets(fake.client as unknown as SupabaseClient);
    expect(loaded).toMatchObject({ shared: true, copied: 2 });
    expect(serverPresets(fake)?.map((item) => item.name)).toEqual(["Vinci", "Kumho"]);
  });

  it("máy chủ đã có cấu hình từ máy khác: gộp thêm cấu hình riêng của trình duyệt này, không làm mất", async () => {
    storage.set(LOCAL_KEY, JSON.stringify([preset("vinci", "Vinci"), preset("kumho", "Kumho")]));
    const fake = serverWith({ presets: [preset("vinci", "Vinci (máy khác)"), preset("posco", "Posco")] });
    const loaded = await loadPresets(fake.client as unknown as SupabaseClient);
    expect(loaded.presets.map((item) => item.name)).toEqual(["Vinci (máy khác)", "Posco", "Kumho"]);
    expect(loaded.copied).toBe(1);
    expect(serverPresets(fake)?.map((item) => item.id)).toEqual(["vinci", "posco", "kumho"]);
  });

  it("trình duyệt chỉ có cấu hình mặc định: lấy cấu hình máy chủ, không ghi gì; máy chủ chưa sẵn sàng thì dùng tạm trên trình duyệt", async () => {
    const fake = serverWith({ presets: [preset("posco", "Posco")] });
    expect(await loadPresets(fake.client as unknown as SupabaseClient)).toMatchObject({ shared: true, presets: [{ id: "posco" }] });
    expect(storage.has(LOCAL_KEY)).toBe(false);

    storage.set(LOCAL_KEY, JSON.stringify([preset("vinci", "Vinci")]));
    const missingRow = createFakeSupabase({ settings: [{ id: "global", version: 0, doc: {} }] });
    const loaded = await loadPresets(missingRow.client as unknown as SupabaseClient);
    expect(loaded).toMatchObject({ shared: false, presets: [{ id: "vinci" }] });
    expect(loaded.warning).toMatch(/chưa có chỗ lưu/);
  });
});
