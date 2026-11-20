import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

/**
 * Cài đặt trên máy (lưu AsyncStorage, không đồng bộ lên máy chủ).
 *  - gpsWarmup: mở Điểm danh là lấy GPS sẵn, bấm chấm công khỏi chờ.
 *  - gpsFast: chấp nhận vị trí vừa đo trong 1 phút, độ chính xác vừa phải (nhanh hơn).
 *  - rememberSite: tự chọn lại công trường lần trước.
 *  - flash: đèn khi chụp ảnh điểm danh — tự động khi tối / luôn bật / tắt.
 *  - mirrorSelfie: ảnh camera trước giữ chiều như lúc xem trước (như soi gương).
 */
export type FlashPref = "auto" | "on" | "off";
export type Settings = { gpsWarmup: boolean; gpsFast: boolean; rememberSite: boolean; flash: FlashPref; mirrorSelfie: boolean };

export const DEFAULT_SETTINGS: Settings = { gpsWarmup: true, gpsFast: true, rememberSite: true, flash: "auto", mirrorSelfie: true };
const KEY = "tnm.settings";

type Ctx = { settings: Settings; update: (patch: Partial<Settings>) => void; reset: () => void };
const SettingsContext = createContext<Ctx>({ settings: DEFAULT_SETTINGS, update: () => undefined, reset: () => undefined });

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

  useEffect(() => {
    void AsyncStorage.getItem(KEY)
      .then((raw) => { if (raw) setSettings({ ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) }); })
      .catch(() => undefined);
  }, []);

  const save = useCallback((next: Settings) => { void AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => undefined); }, []);
  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((current) => { const next = { ...current, ...patch }; save(next); return next; });
  }, [save]);
  const reset = useCallback(() => { setSettings(DEFAULT_SETTINGS); save(DEFAULT_SETTINGS); }, [save]);

  const value = useMemo(() => ({ settings, update, reset }), [settings, update, reset]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export const useSettings = () => useContext(SettingsContext);
