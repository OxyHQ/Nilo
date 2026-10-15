import { beforeEach, describe, expect, it, vi } from 'vitest';

const getMany = vi.fn();

vi.mock('../../middleware/auth.js', () => ({
  oxyClient: { users: { getMany: (ids: string[]) => getMany(ids) } },
}));

vi.mock('../logger.js', () => ({
  log: { general: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
}));

const { loadMemberProfiles } = await import('../member-profiles.js');

describe('loadMemberProfiles', () => {
  beforeEach(() => {
    getMany.mockReset();
  });

  it('hydrates every member in one batch lookup', async () => {
    getMany.mockResolvedValue([
      {
        id: 'u1',
        username: 'ana',
        name: { first: 'Ana', last: 'Ruiz', full: 'Ana Ruiz' },
        avatar: 'f1',
      },
      { id: 'u2', username: 'bo', name: { first: 'Bo' } },
    ]);

    const profiles = await loadMemberProfiles(['u1', 'u2']);

    expect(getMany).toHaveBeenCalledTimes(1);
    expect(getMany).toHaveBeenCalledWith(['u1', 'u2']);
    expect(profiles.get('u1')).toEqual({
      id: 'u1',
      username: 'ana',
      email: null,
      name: { first: 'Ana', last: 'Ruiz', full: 'Ana Ruiz' },
      avatar: 'f1',
    });
    expect(profiles.get('u2')?.avatar).toBeNull();
  });

  it('returns no profiles, rather than failing the list, when Oxy is unavailable', async () => {
    getMany.mockImplementation(async () => {
      throw new Error('network');
    });
    const profiles = await loadMemberProfiles(['u1']);
    expect(profiles.size).toBe(0);
  });

  it('makes no request for an empty list', async () => {
    await loadMemberProfiles([]);
    expect(getMany).not.toHaveBeenCalled();
  });
});
