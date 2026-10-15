export type ReminderChoice = 'hour' | 'tomorrow' | 'week';
/** Calendar choices keep local wall-clock time across DST changes. */
export function reminderQuickChoice(choice: ReminderChoice, now = new Date()): Date {
  const date = new Date(now);
  if (choice === 'hour') return new Date(now.getTime() + 60 * 60 * 1000);
  date.setDate(date.getDate() + (choice === 'tomorrow' ? 1 : 7));
  if (choice === 'tomorrow') date.setHours(9, 0, 0, 0);
  return date;
}
export function reminderFields(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  };
}
/** Reject rollovers (including nonexistent local DST times) and out-of-range dates. */
export function parseReminderTime(date: string, time: string, now = new Date()): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const [year, month, day] = date.split('-').map(Number);
  const [hours, minutes] = time.split(':').map(Number);
  const result = new Date(year, month - 1, day, hours, minutes);
  const fields = reminderFields(result);
  const latest = new Date(now);
  latest.setFullYear(latest.getFullYear() + 5);
  if (fields.date !== date || fields.time !== time || result <= now || result > latest) return null;
  return result;
}
