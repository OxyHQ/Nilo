import { useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/lib/api/client';
import { API_ROUTES } from '@/lib/api/routes';
import type { NewPageDestination } from '@/lib/stores/new-page-store';
import type { BuiltInTemplate, TemplateLocale } from '@/lib/templates/built-in';
import { encodeEmoji } from '@/components/page-chrome/icon-value';
import { queryKeys } from './query-keys';

/** Where a template was made: a page, or a full-page database. */
export type MadeFromTemplate = { kind: 'page' | 'database'; id: string };

/**
 * Make one of Nilo's templates at `destination`: a page through the import
 * (its Markdown becomes blocks, as a pasted page would), a database with its
 * properties and, for a tracker, a board beside its table — at the top of
 * the destination's section (`BuiltInTemplates` offers databases only there).
 */
export function useBuiltInTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      template,
      locale,
      destination,
    }: {
      template: BuiltInTemplate;
      locale: TemplateLocale;
      destination: NewPageDestination;
    }): Promise<MadeFromTemplate> => {
      const icon = encodeEmoji(template.icon);
      if (template.kind === 'page') {
        const words = template.words[locale];
        const res = await apiClient.post<{ pages: { id: string }[] }>(API_ROUTES.pages.import, {
          workspaceId: destination.workspaceId,
          parentId: destination.parentId ?? undefined,
          teamspaceId: destination.teamspaceId,
          files: [{ path: `${words.title}.md`, content: `# ${words.title}\n\n${words.markdown}` }],
        });
        const id = res.data.pages[0]?.id;
        if (!id) throw new Error('The template made no page');
        await apiClient.patch(API_ROUTES.pages.update(id), { icon });
        return { kind: 'page', id };
      }
      const words = template.words[locale];
      const res = await apiClient.post<{ database: { id: string } }>(API_ROUTES.databases.create, {
        workspaceId: destination.workspaceId,
        // A full-page database: one inside a page is that page's block, made there.
        teamspaceId: destination.teamspaceId,
        name: words.title,
        icon,
        schema: words.schema,
      });
      const id = res.data.database.id;
      if (template.board) {
        await apiClient.post(API_ROUTES.databases.createView(id), {
          name: template.board.name[locale],
          type: 'board',
          groupBy: { propertyId: template.board.groupBy },
        });
      }
      return { kind: 'database', id };
    },
    onSuccess: (_made, { destination }) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.pages.list(destination.workspaceId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.databases.list(destination.workspaceId),
      });
    },
  });
}
