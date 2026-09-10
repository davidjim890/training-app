// lib/dates.ts
//
// Pure calendar helpers. All "day keys" are local-time YYYY-MM-DD strings so
// a session started at 23:30 lands on the day you trained, not the UTC day.

/** Local-time YYYY-MM-DD for a Date or ISO datetime string. */
export function dayKey(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export interface CalendarCell {
  key: string;
  dayOfMonth: number;
  inMonth: boolean;
}

/**
 * Six-or-fewer rows of seven cells covering a month, Monday first, padded
 * with the neighbouring months' days so every row is full.
 * `month` is 1-based.
 */
export function monthGrid(year: number, month: number): CalendarCell[][] {
  const first = new Date(year, month - 1, 1);
  const daysInMonth = new Date(year, month, 0).getDate();
  // JS getDay(): 0 Sun … 6 Sat. Shift so Monday is 0.
  const lead = (first.getDay() + 6) % 7;
  const cells: CalendarCell[] = [];
  for (let i = -lead; cells.length % 7 !== 0 || i < daysInMonth; i++) {
    const d = new Date(year, month - 1, 1 + i);
    cells.push({ key: dayKey(d), dayOfMonth: d.getDate(), inMonth: d.getMonth() === month - 1 });
    if (i >= daysInMonth - 1 && cells.length % 7 === 0) break;
  }
  const rows: CalendarCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  return rows;
}

/** First and last day keys of a month, for range queries. */
export function monthBounds(year: number, month: number): { start: string; end: string } {
  return { start: dayKey(new Date(year, month - 1, 1)), end: dayKey(new Date(year, month, 0)) };
}

export function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const d = new Date(year, month - 1 + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

export function monthLabel(year: number, month: number, locale?: string): string {
  return new Date(year, month - 1, 1).toLocaleDateString(locale, { month: "long", year: "numeric" });
}

export const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
