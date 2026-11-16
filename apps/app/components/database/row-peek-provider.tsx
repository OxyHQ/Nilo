import { useRouter } from 'expo-router';
import * as React from 'react';
import type { DatabaseView } from '@/lib/types/databases';
import { OpenRowContext, openRowMode } from './open-row';
import { RowPeek } from './row-peek';

interface PeekState {
  rowId: string;
  opening: number;
}

/**
 * The rows a view opens (`useOpenRow`): in a side peek (a panel beside the
 * view on a wide screen) or a centre peek (over it), each using Bloom's compact
 * detail surface on a phone, or as their own page, as the view says (`config.openIn`). A row
 * opened from a relation opens the same way.
 */
export function OpenRowProvider({
  view,
  children,
}: {
  view: Pick<DatabaseView, 'config'>;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const mode = openRowMode(view);
  const nextOpening = React.useRef(0);
  const [peek, setPeek] = React.useState<PeekState | null>(null);
  const open = React.useCallback(
    (rowId: string) => {
      if (mode === 'full_page') {
        router.push({ pathname: '/p/[pageId]', params: { pageId: rowId } });
        return;
      }
      setPeek({ rowId, opening: ++nextOpening.current });
    },
    [mode, router],
  );
  return (
    <OpenRowContext.Provider value={open}>
      {children}
      {peek ? (
        <RowPeek
          key={peek.opening}
          rowId={peek.rowId}
          mode={mode === 'center_peek' ? 'center' : 'side'}
          // Bloom calls this after exit; a stale exit cannot release a newer row.
          onClose={() => setPeek((current) => (current === peek ? null : current))}
          onOpenFullPage={() => {
            router.push({ pathname: '/p/[pageId]', params: { pageId: peek.rowId } });
          }}
        />
      ) : null}
    </OpenRowContext.Provider>
  );
}
