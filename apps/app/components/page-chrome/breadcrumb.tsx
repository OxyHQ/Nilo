import { useRouter } from 'expo-router';
import { Breadcrumb as BloomBreadcrumb, BreadcrumbItem } from '@oxy.so/bloom/breadcrumb';
import { useTranslation } from '@/hooks/useTranslation';
import { useBreadcrumb } from '@/lib/hooks/use-pages';
import { IconDisplay } from './icon-display';
import type { BreadcrumbEntry, Page } from '@/lib/types/pages';

interface BreadcrumbProps {
  currentPage: Pick<Page, 'id' | 'workspaceId' | 'title' | 'icon'>;
}

/**
 * Parent › … › Current. Only authorized page ancestors form this path.
 * Bloom owns fitting and the menu for ancestors that do not fit the header.
 */
export function Breadcrumb({ currentPage }: BreadcrumbProps) {
  const router = useRouter();
  const { t } = useTranslation();
  const { data: crumb } = useBreadcrumb(currentPage.id, currentPage.workspaceId);

  const entries: BreadcrumbEntry[] = crumb?.breadcrumb ?? [];
  // Drop the trailing self entry from the clickable list; it renders as the
  // active label.
  const ancestors = entries.filter((entry) => entry.id !== currentPage.id);
  // Page metadata has one owner, including optimistic edits and remote refreshes.
  const current = currentPage;

  return (
    <BloomBreadcrumb overflow="collapse">
      {ancestors.map((entry) => (
        <BreadcrumbItem
          key={entry.id}
          href={`/p/${entry.id}`}
          onPress={() => router.push(`/p/${entry.id}`)}
          accessibilityLabel={entry.title.trim() || t('pages.untitled')}
          leading={
            entry.icon ? <IconDisplay value={entry.icon} size={16} pageId={entry.id} /> : null
          }
        >
          {entry.title.trim() || t('pages.untitled')}
        </BreadcrumbItem>
      ))}

      {current ? (
        <BreadcrumbItem
          current
          leading={
            current.icon ? <IconDisplay value={current.icon} size={16} pageId={current.id} /> : null
          }
        >
          {current.title.trim() || t('pages.untitled')}
        </BreadcrumbItem>
      ) : null}
    </BloomBreadcrumb>
  );
}
