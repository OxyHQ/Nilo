import { toast } from '@oxy.so/bloom/toast';
import { View } from 'react-native';
import { usePageEditorContext } from '@/components/page-editor/page-editor-context';
import { Switch } from '@/components/ui/switch';
import { Text } from '@/components/ui/text';
import { useTranslation } from '@/hooks/useTranslation';
import { toCanvas, toDocument } from '@/lib/editor/canvas';
import { useUpdatePage } from '@/lib/hooks/use-pages';
import type { Page } from '@/lib/types/pages';

/**
 * Lay the page out as notes on a canvas, or back as a document. The blocks
 * change first, as one undo step everyone sees; then the page's mode. If the
 * mode cannot be saved, the blocks are put back.
 */
export function CanvasSwitch({ page }: { page: Page }) {
  const { t } = useTranslation();
  const { store } = usePageEditorContext();
  const updatePage = useUpdatePage();
  if (!store) return null;
  const canvas = page.mode === 'canvas';
  return (
    <View className="gap-0.5 px-3 py-1.5">
      <View className="flex-row items-center justify-between gap-3">
        <Text className="text-sm">{t('pages.canvas.mode')}</Text>
        <Switch
          value={canvas}
          disabled={updatePage.isPending || page.locked}
          accessibilityLabel={t('pages.canvas.mode')}
          onValueChange={(next) => {
            store.sealHistory();
            const changed = store.run(next ? toCanvas : toDocument);
            updatePage.mutate(
              { id: page.id, mode: next ? 'canvas' : 'document' },
              {
                onError: () => {
                  if (changed) store.undo();
                  toast.error(t('pages.canvas.failed'));
                },
              },
            );
          }}
        />
      </View>
      <Text className="text-xs text-muted-foreground">{t('pages.canvas.hint')}</Text>
    </View>
  );
}
