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
          key="csv"
          disabled={exportCsv.isPending}
          onSelect={() => void download()}
        >
          <DropdownMenu.ItemTitle>{t('databases.csv.export')}</DropdownMenu.ItemTitle>
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}
