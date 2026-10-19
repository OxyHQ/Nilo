import { useDatabase } from '@/lib/hooks/use-databases';
import { useAddProperty, useDeleteProperty } from '@/lib/hooks/use-database-properties';
import { subItemProperties } from '@/lib/sub-items';
import { RiMoreLine } from '@oxy.so/bloom/icons/RiMoreLine';
import { Button } from '@oxy.so/bloom/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@oxy.so/bloom/dropdown-menu';
import { confirm } from '@oxy.so/bloom/surfaces';
import { toast } from '@oxy.so/bloom/toast';
import { useTranslation } from '@/hooks/useTranslation';
import { useExportDatabase } from '@/lib/hooks/use-page-transfer';
import { saveExport } from '@/lib/save-export';

/** The database's menu; a reader's (`readOnly`) only exports it. */
export function DatabaseActionsMenu({
  databaseId,
  readOnly = false,
}: {
  databaseId: string;
  readOnly?: boolean;
}) {
  const { t } = useTranslation();
  const exportCsv = useExportDatabase();
  const { data } = useDatabase(databaseId);
  const add = useAddProperty();
  const remove = useDeleteProperty();
  const subItems = data ? subItemProperties(data.database) : null;
  const toggleSubItems = async () => {
    try {
      if (subItems) await remove.mutateAsync({ databaseId, propertyId: subItems.children.id });
      else
        await add.mutateAsync({
          databaseId,
          name: t('databases.subItems.name'),
          type: 'relation',
          config: { targetDatabaseId: databaseId, twoWay: true },
        });
    } catch {
      toast.error(t('databases.relations.failed'));
    }
  };
  const disableSubItems = async () => {
    const confirmed = await confirm({
      title: t('databases.subItems.disable'),
      description: t('databases.subItems.removeDescription'),
      confirmLabel: t('common.confirm'),
      cancelLabel: t('common.cancel'),
      destructive: true,
    });
    if (confirmed) await toggleSubItems();
  };
  const download = async () => {
    try {
      await saveExport(
        await exportCsv.mutateAsync({ id: databaseId, fallback: t('databases.untitledDatabase') }),
      );
      toast.success(t('pages.export.downloaded'));
    } catch {
      toast.error(t('pages.toasts.exportFailed'));
    }
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          iconOnly
          appearance="plain"
          accessibilityLabel={t('databases.csv.menu')}
          leadingIcon={RiMoreLine}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" label={t('databases.csv.menu')}>
        {!readOnly ? (
          <DropdownMenuItem
            disabled={!data || add.isPending || remove.isPending}
            onPress={() => void (subItems ? disableSubItems() : toggleSubItems())}
          >
            {t(subItems ? 'databases.subItems.disable' : 'databases.subItems.name')}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem disabled={exportCsv.isPending} onPress={() => void download()}>
          {t('databases.csv.export')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
