const DAY_MS = 86_400_000;

export function isValidISODate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthLength = month === 2 ? leap ? 29 : 28 : month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
  return day >= 1 && day <= monthLength;
}

function ordinal(value: string): number {
  return Math.floor(Date.UTC(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10))) / DAY_MS);
}

export function diffDays(a: string, b: string): number {
  return ordinal(b) - ordinal(a);
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function addDays(value: string, amount: number): string {
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const date = new Date(Date.UTC(year, month - 1, day + amount));
  return `${String(date.getUTCFullYear()).padStart(4, "0")}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

export function addMonths(value: string, amount: number): string {
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const zeroMonth = year * 12 + month - 1 + amount;
  const targetYear = Math.floor(zeroMonth / 12);
  const targetMonth = ((zeroMonth % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return `${String(targetYear).padStart(4, "0")}-${pad2(targetMonth + 1)}-${pad2(Math.min(day, lastDay))}`;
}

function lastDayOfMonth(value: string): number {
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function monthsBetween(start: string, end: string): number | null {
  if (end < start) return null;
  const sy = Number(start.slice(0, 4));
  const sm = Number(start.slice(5, 7));
  const sd = Number(start.slice(8, 10));
  const ey = Number(end.slice(0, 4));
  const em = Number(end.slice(5, 7));
  const ed = Number(end.slice(8, 10));
  let months = (ey - sy) * 12 + (em - sm);
  const endIsMonthEnd = ed === lastDayOfMonth(end);
  if (ed < sd && !endIsMonthEnd) months -= 1;
  return Math.max(0, months);
}

export function formatTenure(months: number): string {
  const years = Math.floor(months / 12);
  const rest = months % 12;
  if (years && rest) return `${years} năm ${rest} tháng`;
  if (years) return `${years} năm`;
  return `${rest} tháng`;
}

export function formatDate(value: string): string {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}
