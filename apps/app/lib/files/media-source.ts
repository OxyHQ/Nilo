import { useEffect, useRef } from 'react';

/**
 * Keep a player on a working URL for an attachment whose URL is minted anew
 * every few minutes (`useMediaFileUrl`). The first URL is loaded at once; a
 * newer one only while the player is not playing, so playback is never cut
 * to swap an address, and the next press plays from one that works. `load`
 * is told whether it is the first, to keep the position on a later one.
 */
export function useMediaSource(
  url: string | null,
  playing: boolean,
  load: (url: string, first: boolean) => void,
): void {
  const loaded = useRef<string | null>(null);
  const latestLoad = useRef(load);
  latestLoad.current = load;
  useEffect(() => {
    if (!url || url === loaded.current) return;
    if (playing && loaded.current !== null) return;
    const first = loaded.current === null;
    loaded.current = url;
    latestLoad.current(url, first);
  }, [url, playing]);
}
