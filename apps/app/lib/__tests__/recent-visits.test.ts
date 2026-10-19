import { createVisitRecorder, recentPageIds } from '../recent-visits';

describe('recording visits for the server recents', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const setup = () => {
    let clock = 0;
    const send = jest.fn(async (_pageId: string) => undefined);
    const recorder = createVisitRecorder({
      send,
      delayMs: 1000,
      intervalMs: 60_000,
      now: () => clock,
    });
    const advance = (ms: number) => {
      clock += ms;
      jest.advanceTimersByTime(ms);
    };
    return { send, recorder, advance };
  };

  it('records a page once it stays open, not one paged through', () => {
    const { send, recorder, advance } = setup();
    recorder.open('a');
    advance(400);
    recorder.open('b');
    advance(1000);
    expect(send.mock.calls).toEqual([['b']]);
  });

  it('drops the visit of a page closed before the delay', () => {
    const { send, recorder, advance } = setup();
    recorder.open('a');
    advance(500);
    recorder.close();
    advance(2000);
    expect(send).not.toHaveBeenCalled();
  });

  it('records the same page again only after the interval', () => {
    const { send, recorder, advance } = setup();
    recorder.open('a');
    advance(1000);
    recorder.open('a');
    advance(1000);
    expect(send).toHaveBeenCalledTimes(1);
    advance(60_000);
    recorder.open('a');
    advance(1000);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('tries again after a failed send', async () => {
    let clock = 0;
    const send = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const recorder = createVisitRecorder({
      send,
      delayMs: 10,
      intervalMs: 60_000,
      now: () => clock,
    });
    recorder.open('a');
    jest.advanceTimersByTime(10);
    // Let the rejection settle.
    await Promise.resolve();
    await Promise.resolve();
    clock += 20;
    recorder.open('a');
    jest.advanceTimersByTime(10);
    expect(send).toHaveBeenCalledTimes(2);
  });
});

describe('which recents to show', () => {
  it("shows the server's, every device's, when it answered", () => {
    expect(recentPageIds(['b', 'a'], ['a', 'c'])).toEqual(['b', 'a']);
    expect(recentPageIds([], ['a'])).toEqual([]);
  });

  it("falls back to this device's own without the server", () => {
    expect(recentPageIds(undefined, ['a', 'c'])).toEqual(['a', 'c']);
  });
});
