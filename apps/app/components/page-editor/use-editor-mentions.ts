import { useEffect, useMemo, useRef } from 'react';
import type { MentionSource } from '@oxy.so/bloom-editor';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from '@/hooks/useTranslation';
import { usePages } from '@/lib/hooks/use-pages';
import { usePagePermissions } from '@/lib/hooks/use-page-permissions';
import { useWorkspaceMembers, memberProfileName } from '@/lib/hooks/use-workspace-members';
import { queryKeys } from '@/lib/hooks/query-keys';
import apiClient from '@/lib/api/client';
import { API_ROUTES } from '@/lib/api/routes';
import type { SearchResponse } from '@/lib/types/search';
import { mentionablePeople, mentionSearchResults, normalizeMentionQuery } from './mention-search';

export function useEditorMentions(pageId: string, workspaceId: string | undefined): MentionSource {
  const client = useQueryClient();
  const members = useWorkspaceMembers(workspaceId);
  const permissions = usePagePermissions(pageId);
  const pages = usePages(workspaceId ?? null);
  const { t } = useTranslation();
  const latest = useRef({
    workspaceId,
    members: members.data,
    permissions: permissions.data,
    pages: pages.data,
    t,
  });
  latest.current = {
    workspaceId,
    members: members.data,
    permissions: permissions.data,
    pages: pages.data,
    t,
  };
  const generation = useRef(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Changing page/workspace invalidates in-flight answers, just like unmounting.
  useEffect(
    () => () => {
      generation.current++;
    },
    [pageId, workspaceId],
  );
  // Data arrives independently of typing. Read it from a ref so it never replaces
  // the source (and hence the context of every block) on a query-cache update.
  return useMemo(
    () => ({
      indicators: ['@'],
      search: async ({ indicator, text }) => {
        const run = ++generation.current;
        if (indicator !== '@') return [];
        const current = latest.current;
        const query = normalizeMentionQuery(text);
        const localPages = [...(current.pages?.pages ?? [])]
          .filter((page) => !page.archived)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        let found: SearchResponse['results'] = [];
        if (query && current.workspaceId) {
          try {
            const result = await client.fetchQuery({
              queryKey: [...queryKeys.search.results(current.workspaceId, query), 'mentions'],
              queryFn: async ({ signal }) =>
                (
                  await apiClient.get<SearchResponse>(API_ROUTES.search, {
                    params: { workspaceId: current.workspaceId, q: query, limit: 50 },
                    signal,
                  })
                ).data,
              staleTime: 30_000,
              retry: false,
            });
            found = result.results;
          } catch {
            // People and the already loaded, access-filtered page list work offline.
          }
        }
        if (run !== generation.current) return [];
        return mentionSearchResults({
          text,
          people: mentionablePeople(current.members ?? [], current.permissions).map((person) => ({
            id: person.userId,
            name: memberProfileName(person) ?? current.t('pages.info.unknownMember'),
          })),
          pages: [...found.map(({ page }) => page), ...localPages],
          labels: {
            people: current.t('editor.mentions.people'),
            pages: current.t('editor.mentions.pages'),
            untitled: current.t('pages.untitled'),
          },
        });
      },
    }),
    [client],
  );
}
