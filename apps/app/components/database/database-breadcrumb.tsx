import { useRouter } from 'expo-router';
import { Breadcrumb, BreadcrumbItem } from '@oxy.so/bloom/breadcrumb';
import { PopoverTrigger } from '@oxy.so/bloom/popover';
import { useTranslation } from '@/hooks/useTranslation';
import { useBreadcrumb } from '@/lib/hooks/use-pages';
import type { Database } from '@/lib/types/databases';
import { IconDisplay } from '@/components/page-chrome/icon-display';
import { IdentityPopover } from '@/components/page-chrome/identity-popover';

interface DatabaseBreadcrumbProps {
  database: Pick<Database, 'id' | 'workspaceId' | 'parentPageId' | 'name' | 'icon'>;
  onRename?: (title: string) => Promise<unknown>;
  onChooseIcon?: () => void;
}

/** Page ancestry is authorized by the API; current metadata belongs to the database query. */
export function DatabaseBreadcrumb({ database, onRename, onChooseIcon }: DatabaseBreadcrumbProps) {
  const router = useRouter();
  const { t } = useTranslation();
  const { data, isError } = useBreadcrumb(database.parentPageId, database.workspaceId);
  // A failed permission recheck must not keep showing cached ancestor names.
  const ancestors = isError ? [] : (data?.breadcrumb ?? []);

  const trail = (
    <Breadcrumb overflow="collapse" separator="/">
      {ancestors.map((page) => (
        <BreadcrumbItem
          key={page.id}
          href={`/p/${page.id}`}
          onPress={() => router.push(`/p/${page.id}`)}
          accessibilityLabel={page.title.trim() || t('pages.untitled')}
          leading={page.icon ? <IconDisplay value={page.icon} size={16} pageId={page.id} /> : null}
        >
          {page.title.trim() || t('pages.untitled')}
        </BreadcrumbItem>
      ))}
      <BreadcrumbItem
        current
        trigger={onRename && onChooseIcon ? <PopoverTrigger asChild /> : undefined}
        leading={<IconDisplay value={database.icon} size={16} showPlaceholder />}
      >
        {database.name.trim() || t('databases.untitledDatabase')}
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
