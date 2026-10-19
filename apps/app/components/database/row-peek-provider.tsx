import { useRouter } from 'expo-router';
import * as React from 'react';
import type { DatabaseView } from '@/lib/types/databases';
import { OpenRowContext, openRowMode } from './open-row';
import { RowPeek } from './row-peek';

interface PeekState {
  rowId: string;
  open: boolean;
}

/**
 * The rows a view opens (`useOpenRow`): in a side peek (a panel beside the
 * view on a wide screen) or a centre peek (over it), each a bottom sheet on a
 * phone, or as their own page, as the view says (`config.openIn`). A row
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
  const [peek, setPeek] = React.useState<PeekState | null>(null);
  const open = React.useCallback(
    (rowId: string) => {
      if (mode === 'full_page') {
        router.push({ pathname: '/p/[pageId]', params: { pageId: rowId } });
        return;
      }
      setPeek({ rowId, open: true });
    },
    [mode, router],
  );
  // The page stays while the peek slides away.
  const close = React.useCallback(() => setPeek((p) => (p ? { ...p, open: false } : p)), []);
  return (
    <OpenRowContext.Provider value={open}>
      {children}
      {peek ? (
        <RowPeek
          key={peek.rowId}
          rowId={peek.rowId}
          open={peek.open}
          mode={mode === 'center_peek' ? 'center' : 'side'}
          onClose={close}
          onOpenFullPage={() => {
            close();
            router.push({ pathname: '/p/[pageId]', params: { pageId: peek.rowId } });
          }}
        />
      ) : null}
    </OpenRowContext.Provider>
  );
}
