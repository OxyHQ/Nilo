import { useCallback } from 'react';
import * as Clipboard from 'expo-clipboard';
import { toast } from '@oxy.so/bloom/toast';
import { useTranslation } from '@/hooks/useTranslation';
import { buildPageUrl } from './build-share-url';

/** The header and page menu copy the same direct URL, without changing access. */
export function useCopyPageLink(pageId: string) {
  const { t } = useTranslation();
  return useCallback(async () => {
    try {
      await Clipboard.setStringAsync(buildPageUrl(pageId));
      toast.success(t('pages.toasts.linkCopied'));
    } catch {
      toast.error(t('pages.toasts.copyLinkFailed'));
    }
  }, [pageId, t]);
}
