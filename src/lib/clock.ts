export interface Clock {
  now(): string;
}

export function todayVN(clock: Clock): string {
  const instant = clock.now();
  const date = new Date(instant);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export const fixedClock = (instant: string): Clock => ({ now: () => instant });
export const systemClock: Clock = { now: () => new Date().toISOString() };
