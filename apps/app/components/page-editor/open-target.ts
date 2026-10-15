import type { MentionMark } from '@oxy.so/bloom-text/model';
import { isSafeLink } from '@oxy.so/bloom-text/model';
import { useCallback } from 'react';
import { useRouter } from 'expo-router';
import { Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

export function openEditorLink(href: string): void {
  if (!isSafeLink(href)) return;
  if (Platform.OS === 'web') window.open(href, '_blank', 'noopener,noreferrer');
  else void WebBrowser.openBrowserAsync(href);
}

export function useOpenEditorMention() {
  const router = useRouter();
  return useCallback(
    (mention: MentionMark) => {
      const { kind, id } = mention.attributes;
      if (kind === 'page' && id)
        router.push({ pathname: '/(app)/p/[pageId]', params: { pageId: id } });
      // Nilo has no other-person profile view yet.
    },
    [router],
  );
}
