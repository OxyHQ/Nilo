import { RiShareLine } from '@oxy.so/bloom/icons/RiShareLine';
import { RiLockLine } from '@oxy.so/bloom/icons/RiLockLine';
import { Button } from '@oxy.so/bloom/button';
import { useDialogControl } from '@oxy.so/bloom/dialog';
import { ShareModal } from './share-modal';
import { useTranslation } from '@/hooks/useTranslation';

interface ShareButtonProps {
  pageId: string;
  /** Compact icon-only mode for tight headers. Defaults to false. */
  compact?: boolean;
  restricted?: boolean;
}

/**
 * ShareButton — opens the ShareModal for a given page.
 * Intended to be placed in the page detail header (top-right). Safe to
 * render anywhere; the only requirement is a valid pageId.
 */
export function ShareButton({ pageId, compact = false, restricted = false }: ShareButtonProps) {
  const { t } = useTranslation();
  const control = useDialogControl();

  if (!pageId) return null;

  return (
    <>
      <Button
        appearance="plain"
        tone="neutral"
        iconOnly={compact}
        onPress={control.open}
        accessibilityLabel={t('sharing.button.label')}
        leadingIcon={restricted ? RiLockLine : RiShareLine}
      >
        {compact ? undefined : t('sharing.button.share')}
      </Button>
      <ShareModal control={control} pageId={pageId} />
    </>
  );
}
