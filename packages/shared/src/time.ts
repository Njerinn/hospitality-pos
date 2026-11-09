const NAIROBI_TZ = 'Africa/Nairobi';

/**
 * Convert a UTC Date to a Nairobi-localized ISO-8601 string with explicit +03:00 offset.
 * All DB writes remain UTC; use this ONLY at the presentation layer.
 */
export function toNairobiISOString(date: Date): string {
  const formatted = new Intl.DateTimeFormat('sv-SE', {
    timeZone: NAIROBI_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
  return formatted.replace(' ', 'T') + '+03:00';
}

/**
 * Parse Safaricom's TransTime "YYYYMMDDHHmmss" (which is Nairobi local time)
 * and return a UTC Date.
 */
export function parseMpesaNairobiTime(s: string): Date {
  const y = Number(s.slice(0, 4));
  const mo = Number(s.slice(4, 6)) - 1;
  const d = Number(s.slice(6, 8));
  const h = Number(s.slice(8, 10));
  const mi = Number(s.slice(10, 12));
  const se = Number(s.slice(12, 14));
  return new Date(Date.UTC(y, mo, d, h - 3, mi, se));
}
