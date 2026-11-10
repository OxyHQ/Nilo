import { useRouter } from 'expo-router';
import { Breadcrumb, BreadcrumbItem } from '@oxy.so/bloom/breadcrumb';
import { PopoverTrigger } from '@oxy.so/bloom/popover';
import { useTranslation } from '@/hooks/useTranslation';
import { useBreadcrumb } from '@/lib/hooks/use-pages';
import type { Database } from '@/lib/types/databases';
import { IconDisplay } from '@/components/page-chrome/icon-display';
import { IdentityPopover } from '@/components/page-chrome/identity-popover';
import { BreadcrumbNeighbors } from '@/components/page-chrome/breadcrumb-neighbors';
import { RiArrowDownSLine } from '@oxy.so/bloom/icons/RiArrowDownSLine';

interface DatabaseBreadcrumbProps {
  database: Pick<Database, 'id' | 'workspaceId' | 'parentPageId' | 'name' | 'icon'>;
  onRename?: (title: string) => Promise<unknown>;
  onChooseIcon?: () => void;
  /** The adjacent PageHeader title already names the current database. */
  hideCurrentLabel?: boolean;
}

/** Page ancestry is authorized by the API; current metadata belongs to the database query. */
export function DatabaseBreadcrumb({
  database,
  onRename,
  onChooseIcon,
  hideCurrentLabel = false,
}: DatabaseBreadcrumbProps) {
  const router = useRouter();
  const { t } = useTranslation();
  const { data, isError } = useBreadcrumb(database.parentPageId, database.workspaceId);
  // A failed permission recheck must not keep showing cached ancestor names.
  const ancestors = isError ? [] : (data?.breadcrumb ?? []);

  const trail = (
    <Breadcrumb overflow="collapse" separator="/">
      {ancestors.map((page, index) => (
        <BreadcrumbItem
          key={page.id}
          href={`/p/${page.id}`}
          onPress={() => router.push(`/p/${page.id}`)}
          accessibilityLabel={page.title.trim() || t('pages.untitled')}
          hoverMenu={{
            label: t('pages.navigation.neighbors'),
            content: ({ open }) => (
              <BreadcrumbNeighbors
                anchor={{ kind: 'page', id: page.id, workspaceId: database.workspaceId }}
                enabled={open}
                parentTitle={ancestors[index - 1]?.title}
              />
            ),
          }}
          leading={page.icon ? <IconDisplay value={page.icon} size={16} pageId={page.id} /> : null}
        >
          {page.title.trim() || t('pages.untitled')}
        </BreadcrumbItem>
      ))}
      <BreadcrumbItem
        current
        trigger={onRename && onChooseIcon ? <PopoverTrigger asChild /> : undefined}
        accessibilityLabel={database.name.trim() || t('databases.untitledDatabase')}
        icon={hideCurrentLabel ? RiArrowDownSLine : undefined}
        hoverMenu={{
          label: t('pages.navigation.neighbors'),
          content: ({ open }) => (
            <BreadcrumbNeighbors
              anchor={{ kind: 'database', id: database.id, workspaceId: database.workspaceId }}
              enabled={open}
              parentTitle={ancestors.at(-1)?.title}
            />
          ),
        }}
        leading={
          hideCurrentLabel ? null : <IconDisplay value={database.icon} size={16} showPlaceholder />
        }
      >
        {hideCurrentLabel ? undefined : database.name.trim() || t('databases.untitledDatabase')}
      </BreadcrumbItem>
    </Breadcrumb>
  );
  return onRename && onChooseIcon ? (
    <IdentityPopover
      key={database.id}
      title={database.name}
      icon={<IconDisplay value={database.icon} size={20} showPlaceholder />}
      onSave={onRename}
      onChooseIcon={onChooseIcon}
    >
      {trail}
    </IdentityPopover>
  ) : (
    trail
  );
}
