import { Share2 } from 'lucide-react-native';
import { Button } from '@oxy.so/bloom/button';
import { useDialogControl } from '@oxy.so/bloom/dialog';
import { ShareModal } from './share-modal';
import { useTranslation } from '@/hooks/useTranslation';

interface ShareButtonProps {
  pageId: string;
  /** Compact icon-only mode for tight headers. Defaults to false. */
  compact?: boolean;
}

/**
 * ShareButton — opens the ShareModal for a given page.
 * Intended to be placed in the page detail header (top-right). Safe to
 * render anywhere; the only requirement is a valid pageId.
 */
export function ShareButton({ pageId, compact = false }: ShareButtonProps) {
  const { t } = useTranslation();
  const control = useDialogControl();

  if (!pageId) return null;

  return (
    <>
      <Button
        appearance={compact ? 'subtle' : 'outline'}
        iconOnly={compact}
        onPress={control.open}
        accessibilityLabel={t('sharing.button.label')}
        renderLeadingIcon={({ size, color }) => <Share2 size={size} color={color} />}
      >
        {compact ? undefined : t('sharing.button.share')}
      </Button>
      <ShareModal control={control} pageId={pageId} />
    </>
  );
}
