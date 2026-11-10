"use client";
import { useCallback, useEffect, useState } from "react";
import { CalendarDays, Coins, Plus, Settings2, Trash2 } from "lucide-react";
import { systemClock, todayVN } from "../../../lib/clock";
import { addRate, formatVnd } from "../../../modules/projects/cost";
import type { ProjectStore } from "../../../modules/projects/store";
import type { Holiday, LaborRate, LaborSettings } from "../../../modules/projects/types";
import type { Notify } from "../Toast";
import { EmployeePicker } from "./ProjectsPage";
import { errorMessage, moneyInput, parseMoney, projectText, type EmployeeOption, type EmployeeSource } from "./projectShared";
import "./projects.css";

/** Ngày lễ dương lịch cố định (Điều 112 BLLĐ 2019). Tết Âm lịch và Giỗ Tổ đổi theo năm, Admin tự thêm. */
const FIXED_HOLIDAYS = [["01-01", "Tết Dương lịch"], ["04-30", "Ngày Chiến thắng"], ["05-01", "Quốc tế Lao động"], ["09-02", "Quốc khánh"]] as const;

/** Trang Admin: đơn giá giờ của từng người (có lịch sử), hệ số tăng ca, trần giờ làm và lịch ngày lễ. */
export function LaborRatesPage(props: { store: ProjectStore; ready: boolean; employees: EmployeeSource; setNotice: Notify }) {
  const { store, setNotice } = props;
  const [rates, setRates] = useState<LaborRate[]>([]);
  const [settings, setSettings] = useState<LaborSettings | null>(null);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const apply = useCallback(([rateList, settingsValue, holidayList]: [LaborRate[] | null, LaborSettings, Holiday[]]) => { setRates(rateList ?? []); setSettings(settingsValue); setHolidays(holidayList); }, []);
  const fetchAll = useCallback(() => Promise.all([store.listRates(), store.getSettings(), store.listHolidays()]), [store]);
  const load = useCallback(async () => { try { apply(await fetchAll()); } catch (error) { setNotice(errorMessage(error), "error"); } }, [fetchAll, apply, setNotice]);
  useEffect(() => {
    if (!props.ready) return;
    let active = true;
    void fetchAll().then((result) => { if (active) apply(result); }, (error: unknown) => { if (active) setNotice(errorMessage(error), "error"); });
    return () => { active = false; };
  }, [props.ready, fetchAll, apply, setNotice]);
  useEffect(() => {
    if (!props.employees) return;
    void props.employees.search("").then((list) => setNames(Object.fromEntries(list.map((item) => [item.id, `${item.code} · ${item.name}`]))));
  }, [props.employees]);

  return (
    <section className="pj-page">
      <div className="page-head"><div><h1>Đơn giá & lịch làm việc</h1><p>Chỉ Admin xem và sửa. Đơn giá dùng để tính tiền công khi chỉ huy trưởng duyệt phiếu công.</p></div></div>
      <RatesSection rates={rates} names={names} employees={props.employees} onSave={async (changed) => { try { await store.upsertRates(changed); setNotice("Đã lưu đơn giá.", "success"); await load(); } catch (error) { setNotice(errorMessage(error), "error"); } }}
        onDelete={async (id) => { try { await store.deleteRate(id); await load(); } catch (error) { setNotice(errorMessage(error), "error"); } }} />
      {settings && <SettingsSection settings={settings} onSave={async (next) => { try { await store.saveSettings(next); setNotice("Đã lưu hệ số và trần giờ làm.", "success"); await load(); } catch (error) { setNotice(errorMessage(error), "error"); } }} />}
      <HolidaysSection holidays={holidays} onSave={async (items) => { try { for (const item of items) await store.saveHoliday(item); setNotice(`Đã lưu ${items.length} ngày lễ.`, "success"); await load(); } catch (error) { setNotice(errorMessage(error), "error"); } }}
        onDelete={async (day) => { try { await store.deleteHoliday(day); await load(); } catch (error) { setNotice(errorMessage(error), "error"); } }} />
    </section>
  );
}

function RatesSection(props: { rates: LaborRate[]; names: Record<string, string>; employees: EmployeeSource; onSave: (changed: LaborRate[]) => Promise<void>; onDelete: (id: string) => Promise<void> }) {
  const today = todayVN(systemClock);
  const [person, setPerson] = useState<EmployeeOption | null>(null);
  const [amount, setAmount] = useState(0);
  const [from, setFrom] = useState(today);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [pickerKey, setPickerKey] = useState(0);
  const current = props.rates.filter((rate) => rate.effectiveFrom <= today && (rate.effectiveTo === null || rate.effectiveTo >= today));
  const history = [...props.rates].sort((a, b) => (props.names[a.employeeId] ?? a.employeeId).localeCompare(props.names[b.employeeId] ?? b.employeeId, "vi") || b.effectiveFrom.localeCompare(a.effectiveFrom));

  const submit = async () => {
    if (!person) { setError("Chọn nhân sự."); return; }
    const result = addRate(props.rates, { id: crypto.randomUUID(), employeeId: person.id, hourlyRate: amount, effectiveFrom: from, effectiveTo: null, note: note.trim() });
    if (!result.ok) { setError(projectText(result.code)); return; }
    const before = new Map(props.rates.map((rate) => [rate.id, JSON.stringify(rate)]));
    setError("");
    await props.onSave(result.rates.filter((rate) => before.get(rate.id) !== JSON.stringify(rate)));
    setPerson(null); setAmount(0); setNote(""); setPickerKey((value) => value + 1);
  };

  return (
    <section className="panel pj-section" aria-labelledby="lr-rates-title">
      <h2 id="lr-rates-title"><Coins className="ico" size={18} aria-hidden="true" /> Đơn giá giờ ({current.length} người đang có đơn giá)</h2>
      <div className="form-grid" style={{ padding: 0 }}>
        <EmployeePicker key={pickerKey} label="Nhân sự" source={props.employees} onPick={setPerson} />
        <label className="field"><span>Đơn giá (VNĐ/giờ)</span><input inputMode="numeric" value={moneyInput(amount)} onChange={(event) => setAmount(parseMoney(event.target.value))} /></label>
        <label className="field"><span>Hiệu lực từ ngày</span><input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label className="field"><span>Ghi chú</span><input value={note} placeholder="vd: Tăng lương 2027" onChange={(event) => setNote(event.target.value)} /></label>
        {error && <p className="form-error" role="alert" style={{ gridColumn: "1 / -1" }}>{error}</p>}
        <div className="button-row" style={{ gridColumn: "1 / -1" }}><button type="button" className="button primary" disabled={!person || amount <= 0} onClick={() => void submit()}><Plus className="ico" size={16} aria-hidden="true" /> Thêm đơn giá</button></div>
      </div>
      <small className="muted">Thêm đơn giá mới thì đơn giá đang áp dụng của người đó tự kết thúc vào ngày hôm trước. Phiếu đã duyệt giữ nguyên số tiền cũ; muốn áp đơn giá mới cho tháng chưa khóa sổ, vào Báo cáo của dự án và bấm “Tính lại tiền”.</small>
      {history.length > 0 && (
        <div className="table-scroll">
          <table className="pj-table">
            <thead><tr><th>Nhân sự</th><th className="pj-num">Đơn giá/giờ</th><th>Từ ngày</th><th>Đến ngày</th><th>Ghi chú</th><th /></tr></thead>
            <tbody>{history.map((rate) => (
              <tr key={rate.id}>
                <td>{props.names[rate.employeeId] ?? rate.employeeId}</td>
                <td className="pj-num">{formatVnd(rate.hourlyRate)}</td>
                <td>{rate.effectiveFrom.split("-").reverse().join("/")}</td>
                <td>{rate.effectiveTo ? rate.effectiveTo.split("-").reverse().join("/") : <span className="pill ok">Đang áp dụng</span>}</td>
                <td>{rate.note}</td>
                <td><button type="button" className="button danger icon-button" aria-label="Xóa đơn giá" onClick={() => { if (window.confirm("Xóa dòng đơn giá này? Phiếu đã duyệt không đổi.")) void props.onDelete(rate.id); }}><Trash2 size={14} aria-hidden="true" /></button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function SettingsSection(props: { settings: LaborSettings; onSave: (settings: LaborSettings) => Promise<void> }) {
  const [draft, setDraft] = useState(props.settings);
  const pct = (key: keyof LaborSettings, label: string) => <label className="field"><span>{label} (%)</span><input type="number" min={0} step={10} value={Math.round(draft[key] * 100)} onChange={(event) => setDraft({ ...draft, [key]: (Number(event.target.value) || 0) / 100 })} /></label>;
  const plain = (key: keyof LaborSettings, label: string) => <label className="field"><span>{label}</span><input type="number" min={0} value={draft[key]} onChange={(event) => setDraft({ ...draft, [key]: Number(event.target.value) || 0 })} /></label>;
  return (
    <section className="panel pj-section" aria-labelledby="lr-settings-title">
      <h2 id="lr-settings-title"><Settings2 className="ico" size={18} aria-hidden="true" /> Hệ số tăng ca và trần giờ làm</h2>
      <div className="form-grid" style={{ padding: 0 }}>
        {pct("otWeekday", "Tăng ca ngày thường")}
        {pct("otWeeklyOff", "Tăng ca ngày nghỉ tuần")}
        {pct("otHoliday", "Tăng ca ngày lễ, Tết")}
        {pct("nightBonus", "Phụ cấp làm đêm (cộng thêm)")}
        {plain("maxHoursDay", "Tối đa giờ/ngày (thường + tăng ca)")}
        {plain("maxOtMonth", "Trần tăng ca/tháng (giờ)")}
        {plain("maxOtYear", "Trần tăng ca/năm (giờ)")}
        {plain("backfillDays", "Tổ trưởng được nhập lùi (ngày)")}
      </div>
      <small className="muted">Mặc định theo Bộ luật Lao động 2019: Điều 98 (150%, 200%, 300%, làm đêm thêm 30%) và Điều 107 (12 giờ/ngày, 40 giờ/tháng, 200 giờ/năm). Vượt trần chỉ cảnh báo, không chặn.</small>
      <div className="button-row"><button type="button" className="button primary" onClick={() => void props.onSave(draft)}>Lưu</button></div>
    </section>
  );
}

function HolidaysSection(props: { holidays: Holiday[]; onSave: (items: Holiday[]) => Promise<void>; onDelete: (day: string) => Promise<void> }) {
  const year = todayVN(systemClock).slice(0, 4);
  const [day, setDay] = useState("");
  const [name, setName] = useState("");
  return (
    <section className="panel pj-section" aria-labelledby="lr-holidays-title">
      <div className="pj-section-head">
        <h2 id="lr-holidays-title"><CalendarDays className="ico" size={18} aria-hidden="true" /> Ngày lễ</h2>
        <button type="button" className="button" onClick={() => void props.onSave(FIXED_HOLIDAYS.map(([monthDay, label]) => ({ day: `${year}-${monthDay}`, name: label })))}>Thêm lễ dương lịch năm {year}</button>
      </div>
      <div className="pj-toolbar">
        <label className="sr-only" htmlFor="hd-day">Ngày</label><input id="hd-day" type="date" value={day} onChange={(event) => setDay(event.target.value)} />
        <label className="sr-only" htmlFor="hd-name">Tên ngày lễ</label><input id="hd-name" type="search" placeholder="Tên ngày lễ, vd: Tết Nguyên đán (mùng 1)" value={name} onChange={(event) => setName(event.target.value)} />
        <button type="button" className="button primary" disabled={!day} onClick={() => void props.onSave([{ day, name: name.trim() }]).then(() => { setDay(""); setName(""); })}>Thêm</button>
      </div>
      <small className="muted">Tết Âm lịch, Giỗ Tổ Hùng Vương và ngày nghỉ bù thay đổi theo năm: thêm từng ngày theo thông báo của Bộ LĐ-TB&XH.</small>
      {!props.holidays.length ? <p className="muted">Chưa có ngày lễ.</p> : (
        <ul className="file-chips">{props.holidays.map((item) => (
          <li key={item.day} className="file-chip">{item.day.split("-").reverse().join("/")} {item.name}
            <button type="button" className="link-button" aria-label={`Xóa ngày lễ ${item.day}`} onClick={() => void props.onDelete(item.day)}>×</button>
          </li>
        ))}</ul>
      )}
    </section>
  );
}
