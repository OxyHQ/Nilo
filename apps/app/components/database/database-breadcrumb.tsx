import { useRouter } from 'expo-router';
import { Breadcrumb, BreadcrumbItem } from '@oxy.so/bloom/breadcrumb';
import { useTranslation } from '@/hooks/useTranslation';
import { useBreadcrumb } from '@/lib/hooks/use-pages';
import type { Database } from '@/lib/types/databases';
import { IconDisplay } from '@/components/page-chrome/icon-display';

interface DatabaseBreadcrumbProps {
  database: Pick<Database, 'id' | 'workspaceId' | 'parentPageId' | 'name' | 'icon'>;
}

/** Page ancestry is authorized by the API; current metadata belongs to the database query. */
export function DatabaseBreadcrumb({ database }: DatabaseBreadcrumbProps) {
  const router = useRouter();
  const { t } = useTranslation();
  const { data, isError } = useBreadcrumb(database.parentPageId, database.workspaceId);
  // A failed permission recheck must not keep showing cached ancestor names.
  const ancestors = isError ? [] : (data?.breadcrumb ?? []);

  return (
    <Breadcrumb overflow="collapse">
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
        leading={database.icon ? <IconDisplay value={database.icon} size={16} /> : null}
      >
        {database.name.trim() || t('databases.untitledDatabase')}
      </BreadcrumbItem>
    </Breadcrumb>
  );
}
