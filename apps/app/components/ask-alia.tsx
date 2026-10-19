import { AliaChatSheet, type AliaChatSheetRef } from '@alia.onl/sdk';
import { useAuth } from '@oxy.so/services';
import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef } from 'react';
import { useTranslation } from '@/hooks/useTranslation';

const AskAliaContext = createContext<(() => void) | null>(null);

/**
 * Owns the one Alia chat sheet of the signed-in workspace shell, so the sidebar
 * entry and the sheet it opens live apart (the sidebar is a drawer on small
 * screens and must not remount the sheet).
 *
 * The sheet is mounted only once the session can use the private API; asking
 * while signed out opens the Oxy sign-in dialog instead of a sheet that could
 * not call Alia.
 */
export function AskAliaRoot({ children }: { children: ReactNode }) {
  const { t, locale } = useTranslation();
  const { canUsePrivateApi, signIn } = useAuth();
  const chatRef = useRef<AliaChatSheetRef>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `t` is a new function every render; the locale is what changes the text.
  const welcomeSuggestions = useMemo(
    () => [
      { id: 'write', text: t('alia.suggestion.write') },
      { id: 'organise', text: t('alia.suggestion.organise') },
      { id: 'database', text: t('alia.suggestion.database') },
    ],
    [locale],
  );

  const askAlia = useCallback(() => {
    if (canUsePrivateApi) chatRef.current?.present();
    else void signIn();
  }, [canUsePrivateApi, signIn]);

  return (
    <AskAliaContext value={askAlia}>
      {children}
      {canUsePrivateApi && (
        <AliaChatSheet
          ref={chatRef}
          clientContext={t('alia.clientContext')}
          welcomeSuggestions={welcomeSuggestions}
        />
      )}
    </AskAliaContext>
  );
}

/** Opens the Alia chat sheet, or the sign-in dialog when signed out. */
export function useAskAlia(): () => void {
  const askAlia = useContext(AskAliaContext);
  if (!askAlia) throw new Error('useAskAlia must be used inside <AskAliaRoot>');
  return askAlia;
}
