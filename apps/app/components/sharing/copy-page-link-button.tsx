import { Button } from '@oxy.so/bloom/button';
import { RiLink } from '@oxy.so/bloom/icons/RiLink';
import { useTranslation } from '@/hooks/useTranslation';
import { useCopyPageLink } from './use-copy-page-link';

export function CopyPageLinkButton({ pageId }: { pageId: string }) {
  const { t } = useTranslation();
  const copy = useCopyPageLink(pageId);
  return (
    <Button
      iconOnly
      appearance="plain"
      tone="neutral"
      accessibilityLabel={t('pages.actions.copyLink')}
      title={t('pages.actions.copyLink')}
      leadingIcon={RiLink}
      onPress={() => void copy()}
    />
  );
}
