import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { relativeEditTime, usePageClock } from '../page-time';

const now = Date.parse('2026-10-21T12:00:00Z');
it.each([
  [now - 30_000, /30.*sec/],
  [now - 120_000, /2.*min/],
  [now - 7_200_000, /2.*hr/],
  [now - 172_800_000, /2.*days/],
])('formats a past edit without using a future tense (%s)', (date, expected) => {
  expect(relativeEditTime(new Date(date).toISOString(), 'en', now)).toMatch(expected);
});
it('handles invalid timestamps and future clock skew without misleading dates', () => {
  expect(relativeEditTime('invalid', 'en', now)).toBe('');
  expect(relativeEditTime(new Date(now + 60_000).toISOString(), 'en', now)).toBe('now');
  expect(relativeEditTime(new Date(now - 120_000).toISOString(), 'es', now)).toContain('hace');
});
it('refreshes elapsed time each minute and releases its timer on unmount', () => {
  jest.useFakeTimers();
  jest.setSystemTime(now);
  let value = 0;
  let renders = 0;
  let renderer!: ReactTestRenderer;
  function Clock() {
    value = usePageClock();
    renders++;
    return null;
  }
  try {
    act(() => {
      renderer = create(<Clock />);
    });
    expect(value).toBe(now);
    expect(jest.getTimerCount()).toBe(1);
    act(() => jest.advanceTimersByTime(60_000));
    expect(value).toBe(now + 60_000);
    act(() => renderer.unmount());
    const previous = renders;
    expect(jest.getTimerCount()).toBe(0);
    act(() => jest.advanceTimersByTime(60_000));
    expect(renders).toBe(previous);
  } finally {
    jest.useRealTimers();
  }
});
