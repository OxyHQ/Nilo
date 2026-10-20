import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Breadcrumb as BloomBreadcrumb, BreadcrumbItem } from '@oxy.so/bloom/breadcrumb';
import { Text } from '@oxy.so/bloom/typography';
import { useTranslation } from '@/hooks/useTranslation';
import { useBreadcrumb } from '@/lib/hooks/use-pages';
import { IconDisplay } from './icon-display';
import type { BreadcrumbEntry, Page } from '@/lib/types/pages';

interface BreadcrumbProps {
  currentPage: Pick<Page, 'id' | 'workspaceId' | 'title' | 'icon'>;
  /** Maximum middle crumbs to render before collapsing with `…`. */
  maxItems?: number;
}

/**
 * Parent › … › Current. Only authorized page ancestors form this path.
 * Each ancestor is clickable; the current page is a label. Long chains collapse the middle into
 * `…` to keep the bar from overflowing on narrow viewports.
 */
export function Breadcrumb({ currentPage, maxItems = 4 }: BreadcrumbProps) {
  const router = useRouter();
  const { t } = useTranslation();
  const { data: crumb } = useBreadcrumb(currentPage.id, currentPage.workspaceId);

  const entries: BreadcrumbEntry[] = crumb?.breadcrumb ?? [];
  // Drop the trailing self entry from the clickable list; it renders as the
  // active label.
  const ancestors = entries.filter((entry) => entry.id !== currentPage.id);
  // Page metadata has one owner, including optimistic edits and remote refreshes.
  const current = currentPage;

  const condensed = condenseAncestors(ancestors, maxItems);

  return (
    <BloomBreadcrumb>
      {condensed.map((entry) =>
        entry.kind === 'page' ? (
          <BreadcrumbItem
            key={`page-${entry.page.id}`}
            href={`/p/${entry.page.id}`}
            onPress={() => router.push(`/p/${entry.page.id}`)}
            accessibilityLabel={entry.page.title.trim() || t('pages.untitled')}
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
