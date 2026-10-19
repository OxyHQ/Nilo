import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Breadcrumb as BloomBreadcrumb, BreadcrumbItem } from '@oxy.so/bloom/breadcrumb';
import { Text } from '@oxy.so/bloom/typography';
import { useTranslation } from '@/hooks/useTranslation';
import { useBreadcrumb } from '@/lib/hooks/use-pages';
import { useWorkspace } from '@/lib/hooks/use-workspaces';
import { IconDisplay } from './icon-display';
import type { BreadcrumbEntry } from '@/lib/types/pages';

interface BreadcrumbProps {
  pageId: string;
  workspaceId: string;
  /** Maximum middle crumbs to render before collapsing with `…`. */
  maxItems?: number;
}

/**
 * Workspace › Parent › … › Current. Each crumb is clickable (the last one
 * is the current page — disabled). Long chains collapse the middle into
 * `…` to keep the bar from overflowing on narrow viewports.
 */
export function Breadcrumb({ pageId, workspaceId, maxItems = 4 }: BreadcrumbProps) {
  const router = useRouter();
  const { t } = useTranslation();
  const { data: crumb } = useBreadcrumb(pageId);
  const { data: workspace } = useWorkspace(workspaceId);

  const entries: BreadcrumbEntry[] = crumb?.breadcrumb ?? [];
  // Drop the trailing self entry from the clickable list; it renders as the
  // active label.
  const ancestors = entries.slice(0, -1);
  const current = entries[entries.length - 1];

  const condensed = condenseAncestors(ancestors, maxItems);

  return (
    <BloomBreadcrumb>
      <BreadcrumbItem
        onPress={() => router.push('/(app)')}
        accessibilityLabel={t('pages.breadcrumb.workspaceHome')}
      >
        {workspace?.name ?? t('pages.breadcrumb.workspace')}
      </BreadcrumbItem>

      {condensed.map((entry) =>
        entry.kind === 'page' ? (
          <BreadcrumbItem
            key={`page-${entry.page.id}`}
            onPress={() => router.push(`/p/${entry.page.id}`)}
            accessibilityLabel={entry.page.title || t('pages.untitled')}
            leading={
              entry.page.icon ? (
                <IconDisplay value={entry.page.icon} size={14} pageId={entry.page.id} />
              ) : null
            }
          >
            {entry.page.title.trim() || t('pages.untitled')}
          </BreadcrumbItem>
        ) : (
          // The collapsed middle is not a destination, so it stays a plain
          // list item rather than a pressable `BreadcrumbItem`.
          <View key="ellipsis" role="listitem">
            <Text className="text-xs text-muted-foreground">…</Text>
          </View>
        ),
      )}

      {current ? (
        <BreadcrumbItem
          current
          leading={
            current.icon ? <IconDisplay value={current.icon} size={14} pageId={current.id} /> : null
          }
        >
          {current.title.trim() || t('pages.untitled')}
        </BreadcrumbItem>
      ) : null}
    </BloomBreadcrumb>
  );
}

type CondensedEntry = { kind: 'page'; page: BreadcrumbEntry } | { kind: 'ellipsis' };

/**
 * Notion-like middle truncation: keep the first ancestor and the last two,
 * collapse anything in between as `…`. When the chain is short, return
 * everything as-is.
 */
function condenseAncestors(ancestors: BreadcrumbEntry[], maxItems: number): CondensedEntry[] {
  if (ancestors.length <= maxItems) {
    return ancestors.map((page) => ({ kind: 'page' as const, page }));
  }
  const head = ancestors[0];
  const tail = ancestors.slice(-2);
  return [
    { kind: 'page' as const, page: head },
    { kind: 'ellipsis' as const },
    ...tail.map((page) => ({ kind: 'page' as const, page })),
  ];
}
