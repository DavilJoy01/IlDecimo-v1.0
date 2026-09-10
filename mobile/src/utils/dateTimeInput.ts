export function formatDateInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseDateInput(value: string): Date {
  // Parse the YYYY-MM-DD parts directly into a local-time Date instead of
  // `new Date(value)`, which treats a date-only string as UTC midnight --
  // that reads back one day earlier than formatDateInput's local getters
  // would produce for any timezone west of UTC.
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return new Date(2000, 0, 1);
  const [, year, month, day] = match;
  return new Date(Number(year), Number(month) - 1, Number(day));
}

export function formatTimeInput(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

export function parseTimeInput(value: string, fallback: Date = new Date()): Date {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return fallback;
  const [, hours, minutes] = match;
  const result = new Date(fallback);
  result.setHours(Number(hours), Number(minutes), 0, 0);
  return result;
}
