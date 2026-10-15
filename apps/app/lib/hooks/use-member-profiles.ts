import { useOxy } from '@oxy.so/services';
import { useQuery } from '@tanstack/react-query';
import { getNormalizedUserHandle, type User } from '@oxy.so/core';

export function profileName(profile: User | null | undefined): string | null {
  return profile?.name?.displayName?.trim() || getNormalizedUserHandle(profile) || null;
}
/** Batch hydration, cached independently of caret positions. */
export function useMemberProfiles(userIds: string[]) {
  const { oxyServices } = useOxy();
  const ids = [...new Set(userIds)].sort();
  return useQuery({
    queryKey: ['member-profiles', ids],
    queryFn: () => oxyServices.users.getMany(ids),
    enabled: ids.length > 0,
    staleTime: 5 * 60_000,
  });
}
