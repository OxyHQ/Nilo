import { reminderQuickChoice, reminderFields, parseReminderTime } from '../reminder-time';

describe('reminder time choices', () => {
  it('adds one elapsed hour across midnight without changing the input', () => {
    const now = new Date(2026, 11, 31, 23, 30);
    const result = reminderQuickChoice('hour', now);
    expect(result.getTime() - now.getTime()).toBe(3600000);
    expect(reminderFields(result)).toEqual({ date: '2027-01-01', time: '00:30' });
    expect(now.getFullYear()).toBe(2026);
  });
  it('uses tomorrow at 9 locally, even when today is before 9', () => {
    expect(reminderFields(reminderQuickChoice('tomorrow', new Date(2028, 1, 28, 8)))).toEqual({
      date: '2028-02-29',
      time: '09:00',
    });
    expect(reminderFields(reminderQuickChoice('tomorrow', new Date(2026, 11, 31, 23)))).toEqual({
      date: '2027-01-01',
      time: '09:00',
    });
  });
  it('keeps local wall-clock time seven calendar days later', () => {
    const now = new Date(2026, 2, 25, 14, 35);
    expect(reminderFields(reminderQuickChoice('week', now))).toEqual({
      date: '2026-04-01',
      time: '14:35',
    });
  });
  it('rejects malformed, rolled-over, past, and excessively distant dates', () => {
    const now = new Date(2026, 0, 1, 10);
    for (const [date, time] of [
      ['2026-02-30', '09:00'],
      ['2026-13-01', '09:00'],
      ['2026-01-02', '24:00'],
      ['2026-01-02', '10:60'],
      ['2026-1-2', '09:00'],
      ['2026-01-01', '09:59'],
      ['2026-01-01', '10:00'],
      ['2031-01-01', '10:01'],
    ]) {
      expect(parseReminderTime(date, time, now)).toBeNull();
    }
    expect(parseReminderTime('2031-01-01', '10:00', now)).not.toBeNull();
  });
  it('round-trips local entry to a valid UTC instant with an explicit offset', () => {
    const result = parseReminderTime('2026-06-15', '14:05', new Date(2026, 0, 1));
    expect(result).not.toBeNull();
    expect(reminderFields(result!)).toEqual({ date: '2026-06-15', time: '14:05' });
    expect(result!.toISOString()).toMatch(/Z$/);
  });
});
