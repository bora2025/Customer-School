/**
 * Date formatting utilities for Cambodia (UTC+07:00, Asia/Phnom_Penh).
 */

const CAMBODIA_TZ = 'Asia/Phnom_Penh';

/**
 * Returns the current date in Cambodia (UTC+7) as a YYYY-MM-DD string.
 *
 * Use this instead of `new Date().toISOString().split('T')[0]`, which returns
 * the UTC date — between 00:00 and 07:00 ICT that yields the previous day.
 */
export function todayCambodia(): string {
  const cam = new Date(Date.now() + 7 * 60 * 60 * 1000);
  return cam.toISOString().split('T')[0];
}

/**
 * Format a UTC timestamp as Cambodia time in 24-hour HH:mm format.
 *
 * Use this everywhere an attendance check-in/check-out time must be displayed.
 * It is locale-independent and timezone-correct, always producing e.g. "13:05"
 * instead of the browser-locale-dependent "1:05 PM" or "01:05 PM".
 *
 * @param input  UTC ISO string, Date object, or null/undefined.
 * @param withSeconds  When true, returns HH:mm:ss instead of HH:mm.
 * @returns  e.g. "13:05" or "—" when input is missing/invalid.
 */
export function formatCambodiaTime(
  input: string | Date | null | undefined,
  withSeconds = false,
): string {
  if (!input) return '—';
  const d = typeof input === 'string' ? new Date(input) : input;
  if (isNaN(d.getTime())) return '—';
  // Shift UTC → Cambodia (UTC+7) then read the ISO HH:mm[:ss] slice
  const cambodia = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  return cambodia.toISOString().slice(11, withSeconds ? 19 : 16);
}

/**
 * Format a date-of-birth string for display on ID cards.
 *
 * @param dateStr  ISO date string (e.g. "2000-02-01T00:00:00.000Z") or null/undefined.
 * @param lang     Current app language: 'en' → dd/mm/yyyy, 'kh' → Khmer numerals & month name.
 * @returns        Formatted string, e.g. "01/02/2000" or "១ កុម្ភៈ ២០០០".
 */
export function formatDOB(
  dateStr: string | null | undefined,
  lang: 'en' | 'kh' | string = 'en',
): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '';

  if (lang === 'kh') {
    // Khmer format: ១ កុម្ភៈ ២០០០  (day MonthName year, Khmer numerals)
    return date.toLocaleDateString('km-KH-u-nu-khmr', {
      timeZone: CAMBODIA_TZ,
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }

  // English format: dd/mm/yyyy
  return date.toLocaleDateString('en-GB', {
    timeZone: CAMBODIA_TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}
