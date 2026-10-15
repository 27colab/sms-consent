/**
 * Quiet hours evaluated in the recipient's local time zone (IANA name).
 * The window may wrap midnight (e.g. 21:00 -> 08:00). Start is inclusive, end exclusive.
 */
export interface QuietHours {
  /** "HH:MM", 24h. Default "21:00". */
  start?: string;
  /** "HH:MM", 24h. Default "08:00". */
  end?: string;
}

export const DEFAULT_QUIET_HOURS: Required<QuietHours> = { start: '21:00', end: '08:00' };

function toMinutes(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) throw new Error(`Invalid time "${hhmm}", expected HH:MM`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) throw new Error(`Invalid time "${hhmm}", expected HH:MM`);
  return h * 60 + min;
}

/** Minutes since local midnight at `at` in `timeZone`. Throws RangeError on an unknown zone. */
export function localMinutes(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(at);
  const h = Number(parts.find((p) => p.type === 'hour')!.value);
  const m = Number(parts.find((p) => p.type === 'minute')!.value);
  return h * 60 + m;
}

export function isQuietHour(at: Date, timeZone: string, quiet: QuietHours = {}): boolean {
  const start = toMinutes(quiet.start ?? DEFAULT_QUIET_HOURS.start);
  const end = toMinutes(quiet.end ?? DEFAULT_QUIET_HOURS.end);
  if (start === end) return false;
  const now = localMinutes(at, timeZone);
  return start < end ? now >= start && now < end : now >= start || now < end;
}

/** First minute at or after `at` that is outside quiet hours (searches up to 48h ahead). */
export function nextAllowedTime(at: Date, timeZone: string, quiet: QuietHours = {}): Date {
  const base = new Date(Math.floor(at.getTime() / 60000) * 60000);
  for (let i = 0; i <= 48 * 60; i++) {
    const t = new Date(base.getTime() + i * 60000);
    if (!isQuietHour(t, timeZone, quiet)) return t;
  }
  /* v8 ignore next -- @preserve */
  return at;
}
