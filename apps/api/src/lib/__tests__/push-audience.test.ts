/**
 * Which app a push goes to: a note's reminder rings in Noted when the user has
 * it, and in Nilo otherwise; everything else rings in Nilo. Never both.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../socket.js', () => ({ getIO: () => null }));
vi.mock('../logger.js', () => ({
  log: { general: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
}));

const { pushAudience } = await import('../notification-service.js');

const nilo = { id: 'nilo-phone', app: 'nilo' as const };
const noted = { id: 'noted-phone', app: 'noted' as const };
const aboutNote = { data: { app: 'noted', pageId: 'p' } };
const aboutPage = { data: { pageId: 'p' } };

describe('pushAudience', () => {
  it('sends a note reminder to Noted alone when the user has Noted', () => {
    expect(pushAudience([nilo, noted], aboutNote, true)).toEqual([noted]);
  });

  it('falls back to Nilo when the user has no Noted anywhere', () => {
    expect(pushAudience([nilo], aboutNote, false)).toEqual([nilo]);
  });

  it('sends nothing about a note to a Nilo browser when Noted has it elsewhere', () => {
    // Noted is on the phone; the Nilo web subscription stays quiet.
    expect(pushAudience([nilo], aboutNote, true)).toEqual([]);
  });

  it('keeps everything else in Nilo', () => {
    expect(pushAudience([nilo, noted], aboutPage, true)).toEqual([nilo]);
  });
});
