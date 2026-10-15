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
    queryFn: async () => {
      const batches: string[][] = [];
      for (let i = 0; i < ids.length; i += 100) batches.push(ids.slice(i, i + 100));
      return (await Promise.all(batches.map((batch) => oxyServices.users.getMany(batch)))).flat();
    },
    enabled: ids.length > 0,
    staleTime: 5 * 60_000,
  });
}
