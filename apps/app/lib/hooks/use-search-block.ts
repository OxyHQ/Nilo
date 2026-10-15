import { useEffect } from 'react';
import { Platform } from 'react-native';

/** Wait for the editor to mount its blocks, including a delayed web render. */
export function useSearchBlock(blockId: string | undefined, ready: boolean) {
  useEffect(() => {
    if (Platform.OS !== 'web' || !blockId || !ready) return;
    let observer: MutationObserver | undefined;
    const scroll = () => {
      const block = document.getElementById(`bloom-block-${blockId}`);
      if (!block) return false;
      block.scrollIntoView({ behavior: 'smooth', block: 'center' });
      observer?.disconnect();
      return true;
    };
    if (scroll()) return;
    observer = new MutationObserver(scroll);
    observer.observe(document.body, { childList: true, subtree: true });
    // A block that never appears (deleted since the search) stops the wait.
    const giveUp = setTimeout(() => observer?.disconnect(), 5000);
    return () => {
      clearTimeout(giveUp);
      observer?.disconnect();
    };
  }, [blockId, ready]);
}
