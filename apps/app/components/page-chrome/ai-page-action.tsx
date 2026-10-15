import { usePageEditorContext } from '@/components/page-editor/page-editor-context';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { useTranslation } from '@/hooks/useTranslation';
import { useAiAvailable } from '@/lib/ai/use-ai';

/** "Summarize with AI" in the page's menu, for whoever may edit it, once Oxy offers it. */
export function AiPageAction({ onOpen }: { onOpen: () => void }) {
  const { t } = useTranslation();
  const { store, setAiTarget } = usePageEditorContext();
  const available = useAiAvailable();
  if (!available || !store) return null;
  return (
    <Button
      variant="ghost"
      className="justify-start"
      accessibilityLabel={t('ai.summarizePage')}
      onPress={() => {
        onOpen();
        setAiTarget({ kind: 'page' });
      }}
    >
      <Text className="text-sm">{t('ai.summarizePage')}</Text>
    </Button>
  );
}
