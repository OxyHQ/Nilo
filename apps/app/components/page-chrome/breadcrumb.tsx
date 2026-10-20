import { useRouter } from 'expo-router';
import { Breadcrumb as BloomBreadcrumb, BreadcrumbItem } from '@oxy.so/bloom/breadcrumb';
import { PopoverTrigger } from '@oxy.so/bloom/popover';
import { useTranslation } from '@/hooks/useTranslation';
import { usePageBreadcrumbPath } from '@/lib/hooks/use-page-breadcrumb-path';
import { IconDisplay } from './icon-display';
import { IdentityPopover } from './identity-popover';
import { BreadcrumbNeighbors } from './breadcrumb-neighbors';
import type { Page } from '@/lib/types/pages';

interface BreadcrumbProps {
  currentPage: Pick<Page, 'id' | 'workspaceId' | 'title' | 'icon'> &
    Partial<Pick<Page, 'databaseId'>>;
  onRename?: (title: string) => Promise<unknown>;
  onChooseIcon?: () => void;
}

/**
 * Parent / … / Current. Only authorized page and database ancestors form this path.
 * Bloom owns fitting and the menu for ancestors that do not fit the header.
 */
export function Breadcrumb({ currentPage, onRename, onChooseIcon }: BreadcrumbProps) {
  const router = useRouter();
  const { t } = useTranslation();
  const entries = usePageBreadcrumbPath(currentPage);
  const editable = Boolean(onRename && onChooseIcon);
  const trail = (
    <BloomBreadcrumb overflow="collapse" separator="/">
      {entries.map((entry, index) => (
        <BreadcrumbItem
          key={`${entry.kind}:${entry.id}`}
          href={entry.href}
          onPress={
            entry.href
              ? () => router.push(entry.kind === 'database' ? `/db/${entry.id}` : `/p/${entry.id}`)
              : undefined
          }
          current={entry.current}
          trigger={entry.current && editable ? <PopoverTrigger asChild /> : undefined}
          hoverMenu={{
            label: t('pages.navigation.neighbors'),
            content: ({ open }) => (
              <BreadcrumbNeighbors
                anchor={{ kind: entry.kind, id: entry.id, workspaceId: currentPage.workspaceId }}
                enabled={open}
                parentTitle={entries[index - 1]?.title}
              />
            ),
          }}
          accessibilityLabel={entry.title.trim() || t('pages.untitled')}
          leading={
            <IconDisplay
              value={entry.icon}
              size={16}
              showPlaceholder
              pageId={entry.kind === 'page' ? entry.id : undefined}
            />
          }
        >
          {entry.title.trim() || t('pages.untitled')}
        </BreadcrumbItem>
      ))}
    </BloomBreadcrumb>
  );
  return onRename && onChooseIcon ? (
    <IdentityPopover
      key={currentPage.id}
      title={currentPage.title}
      icon={
        <IconDisplay value={currentPage.icon} size={20} showPlaceholder pageId={currentPage.id} />
      }
      onSave={onRename}
      onChooseIcon={onChooseIcon}
    >
      {trail}
    </IdentityPopover>
  ) : (
    trail
  );
}
