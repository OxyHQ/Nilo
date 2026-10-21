import { DropdownMenuItem } from '@oxy.so/bloom/dropdown-menu';
import { usePageEditorContext } from '@/components/page-editor/page-editor-context';
import { useTranslation } from '@/hooks/useTranslation';
import { useAiAvailable } from '@/lib/ai/use-ai';

/** "Summarize with AI" in the page's menu, for whoever may edit it, once Oxy offers it. */
export function AiPageAction({ onOpen }: { onOpen: () => void }) {
  const { t } = useTranslation();
  const { store, setAiTarget } = usePageEditorContext();
  const available = useAiAvailable();
  if (!available || !store) return null;
  return (
    <DropdownMenuItem
      onPress={() => {
        onOpen();
        setAiTarget({ kind: 'page' });
      }}
    >
      {t('ai.summarizePage')}
    </DropdownMenuItem>
  );
}
