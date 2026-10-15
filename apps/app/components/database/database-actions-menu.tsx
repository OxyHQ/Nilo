import { useState } from 'react';
import { useDatabase } from '@/lib/hooks/use-databases';
import { useAddProperty, useDeleteProperty } from '@/lib/hooks/use-database-properties';
import { subItemProperties } from '@/lib/sub-items';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Pressable } from 'react-native';
import { MoreHorizontal } from 'lucide-react-native';
import { toast } from '@oxy.so/bloom/toast';
import * as DropdownMenu from '@/components/ui/dropdown-menu';
import { useTranslation } from '@/hooks/useTranslation';
import { useColorScheme } from '@/lib/useColorScheme';
import { useExportDatabase } from '@/lib/hooks/use-page-transfer';
import { saveExport } from '@/lib/save-export';

export function DatabaseActionsMenu({ databaseId }: { databaseId: string }) {
  const { t } = useTranslation();
  const { colors } = useColorScheme();
  const exportCsv = useExportDatabase();
  const { data } = useDatabase(databaseId);
  const add = useAddProperty();
  const remove = useDeleteProperty();
  const [confirm, setConfirm] = useState(false);
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
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('databases.csv.menu')}
            className="p-2 rounded hover:bg-muted"
          >
            <MoreHorizontal size={20} color={colors.mutedForeground} />
          </Pressable>
        </DropdownMenu.Trigger>
        <DropdownMenu.Content>
          <DropdownMenu.Item
            key="sub-items"
            disabled={!data || add.isPending || remove.isPending}
            onSelect={() => (subItems ? setConfirm(true) : void toggleSubItems())}
          >
            <DropdownMenu.ItemTitle>
              {t(subItems ? 'databases.subItems.disable' : 'databases.subItems.name')}
            </DropdownMenu.ItemTitle>
          </DropdownMenu.Item>
          <DropdownMenu.Item
            key="csv"
            disabled={exportCsv.isPending}
            onSelect={() => void download()}
          >
            <DropdownMenu.ItemTitle>{t('databases.csv.export')}</DropdownMenu.ItemTitle>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
      <ConfirmationDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t('databases.subItems.disable')}
        description={t('databases.subItems.removeDescription')}
        confirmVariant="destructive"
        loading={remove.isPending}
        onConfirm={toggleSubItems}
      />
    </>
  );
}
