import type { MentionMark } from '@oxy.so/bloom-text/model';
import { isSafeLink } from '@oxy.so/bloom-text/model';
import { useCallback, useRef } from 'react';
import { useRouter } from 'expo-router';
import { Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

export function openEditorLink(href: string): void {
  if (!isSafeLink(href)) return;
  if (Platform.OS === 'web') window.open(href, '_blank', 'noopener,noreferrer');
  else void WebBrowser.openBrowserAsync(href);
}

/**
 * Follow a mention: a page opens; a person shows their card (`onOpenUser`);
 * a date has nowhere to go.
 */
export function useOpenEditorMention(onOpenUser?: (userId: string) => void) {
  const router = useRouter();
  // Read when pressed: the editor's context (and so every block) depends on
  // this callback, so it stays the same when the screen passes a new one.
  const openUser = useRef(onOpenUser);
  openUser.current = onOpenUser;
  return useCallback(
    (mention: MentionMark) => {
      const { kind, id } = mention.attributes;
      if (kind === 'page' && id)
        router.push({ pathname: '/(app)/p/[pageId]', params: { pageId: id } });
      else if (kind === 'user' && id) openUser.current?.(id);
    },
    [router],
  );
}
