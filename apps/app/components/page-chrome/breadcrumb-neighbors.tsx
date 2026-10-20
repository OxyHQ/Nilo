import { usePathname, useRouter } from 'expo-router';
import { DropdownMenuItem, DropdownMenuLabel } from '@oxy.so/bloom/dropdown-menu';
import { useTranslation } from '@/hooks/useTranslation';
import {
  useBreadcrumbNeighbors,
  type BreadcrumbNeighborAnchor,
} from '@/lib/hooks/use-breadcrumb-neighbors';
import { IconDisplay } from './icon-display';

/** Only authorized domain destinations; Bloom owns hover, focus, rows and scrolling. */
export function BreadcrumbNeighbors({
  anchor,
  enabled,
  parentTitle,
}: {
  anchor: BreadcrumbNeighborAnchor;
  enabled: boolean;
  parentTitle?: string;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const neighbors = useBreadcrumbNeighbors(anchor, { enabled });
  return (
    <>
      <DropdownMenuLabel>
        {parentTitle
          ? t('pages.navigation.neighborsIn', { name: parentTitle })
          : t('pages.navigation.neighbors')}
      </DropdownMenuLabel>
      {neighbors.isLoading ? (
        <DropdownMenuLabel>{t('common.loading')}</DropdownMenuLabel>
      ) : neighbors.isError ? (
        <DropdownMenuItem keepOpen onPress={() => void neighbors.refetch()}>
          {t('pages.navigation.retry')}
        </DropdownMenuItem>
      ) : neighbors.items.length === 0 ? (
        <DropdownMenuLabel>{t('pages.navigation.empty')}</DropdownMenuLabel>
      ) : (
        neighbors.items.map((entry) => {
          const title =
            entry.title.trim() ||
            t(entry.kind === 'database' ? 'databases.untitledDatabase' : 'pages.untitled');
          return (
            <DropdownMenuItem
              key={`${entry.kind}:${entry.id}`}
              href={entry.href}
              current={entry.current}
              onPress={() => {
                if (entry.href === pathname) return;
                router.push(entry.kind === 'database' ? `/db/${entry.id}` : `/p/${entry.id}`);
              }}
              accessibilityLabel={title}
              leading={
                <IconDisplay
                  value={entry.icon}
                  size={16}
                  showPlaceholder
                  pageId={entry.kind === 'page' ? entry.id : undefined}
                />
              }
            >
              {title}
            </DropdownMenuItem>
          );
        })
      )}
      {neighbors.hasMore ? (
        <DropdownMenuItem
          keepOpen
          disabled={neighbors.isLoadingMore}
          onPress={() => void neighbors.loadMore()}
        >
          {t(neighbors.isLoadingMore ? 'common.loading' : 'pages.navigation.more')}
        </DropdownMenuItem>
      ) : null}
    </>
  );
}
