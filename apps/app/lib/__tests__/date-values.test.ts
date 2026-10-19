import { withStart } from '../date-values';

describe('editing a date’s start', () => {
  it('keeps the end of a range and that it has no time', () => {
    expect(
      withStart(
        { start: '2026-10-01T00:00:00.000Z', end: '2026-10-05T00:00:00.000Z' },
        '2026-10-02T00:00:00.000Z',
      ),
    ).toEqual({
      start: '2026-10-02T00:00:00.000Z',
      end: '2026-10-05T00:00:00.000Z',
      includeTime: false,
    });
  });

  it('keeps the time of day when only the day was picked', () => {
    expect(
      withStart(
        { start: '2026-10-01T14:30:00.000Z', includeTime: true },
        '2026-10-09T00:00:00.000Z',
      ),
    ).toEqual({ start: '2026-10-09T14:30:00.000Z', end: null, includeTime: true });
  });

  it('starts a date that had none, and clears one', () => {
    expect(withStart(null, '2026-10-09T00:00:00.000Z')).toEqual({
      start: '2026-10-09T00:00:00.000Z',
      end: null,
      includeTime: false,
    });
    expect(
      withStart({ start: '2026-10-01T00:00:00.000Z', end: '2026-10-05T00:00:00.000Z' }, null),
    ).toEqual({
      start: null,
      end: null,
      includeTime: false,
    });
  });
});
