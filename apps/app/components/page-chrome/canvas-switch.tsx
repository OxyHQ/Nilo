import { toast } from '@oxy.so/bloom/toast';
import { usePageEditorContext } from '@/components/page-editor/page-editor-context';
import { DropdownMenuCheckboxItem } from '@oxy.so/bloom/dropdown-menu';
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
    <DropdownMenuCheckboxItem
      indicatorPosition="trailing"
      keepOpen
      checked={canvas}
      disabled={updatePage.isPending || page.locked}
      accessibilityLabel={t('pages.canvas.mode')}
      onCheckedChange={(next) => {
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
    >
      {t('pages.canvas.mode')}
    </DropdownMenuCheckboxItem>
  );
}
