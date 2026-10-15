import { oxyClient } from '../middleware/auth.js';
import { log } from './logger.js';

/** The public Oxy profile a member list shows next to each member. */
export interface MemberProfile {
  id: string;
  username: string | null;
  email: string | null;
  name: { first?: string; last?: string; full?: string } | null;
  avatar: string | null;
}

/**
 * Oxy owns profiles; Nilo stores only user ids. One `users.getMany` call (a
 * round trip per 100 ids) hydrates a whole member list. A failed lookup is
 * logged and yields no profiles: the list still renders, with ids.
 */
export async function loadMemberProfiles(
  userIds: readonly string[],
): Promise<Map<string, MemberProfile>> {
  const profiles = new Map<string, MemberProfile>();
  if (userIds.length === 0) return profiles;
  try {
    const users = await oxyClient.users.getMany([...userIds]);
    for (const user of users) {
      profiles.set(user.id, {
        id: user.id,
        username: user.username ?? null,
        email: user.email ?? null,
        name: user.name
          ? { first: user.name.first, last: user.name.last, full: user.name.full }
          : null,
        avatar: user.avatar ?? null,
      });
    }
  } catch (err: unknown) {
    log.general.warn({ err, count: userIds.length }, 'Member profile lookup failed');
  }
  return profiles;
}
