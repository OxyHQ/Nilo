import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Platform, View } from 'react-native';
import {
  BlockDecorations,
  EditorController,
  EditorToolbar,
  type EditorTheme,
  type EditorLabels,
  type BlockDecoration,
} from '@oxy.so/bloom-editor';
import { usePage } from '@/lib/hooks/use-pages';
import { useOxy } from '@oxy.so/services';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import { useTranslation } from '@/hooks/useTranslation';
import { usePageEditor, type PageEditorState } from '@/lib/editor/use-page-editor';
import { profileName, useMemberProfiles } from '@/lib/hooks/use-member-profiles';
import { useEditorTheme, useEditorLabels } from './editor-presentation';
import { collaboratorDecorations } from './presence';

type EditorContextValue = PageEditorState & {
  /** Null until the page's blocks have loaded (or when they failed: `error`). */
  controller: EditorController | null;
  decorations: BlockDecorations;
  theme: EditorTheme;
  labels: EditorLabels;
  toolbarHeight: number;
  setToolbarHeight: (height: number) => void;
};
const PageEditorContext = createContext<EditorContextValue | null>(null);

export function usePageEditorContext() {
  const value = useContext(PageEditorContext);
  if (!value) throw new Error('PageEditorProvider required');
  return value;
}

/**
 * Exactly one live editing session per page, shared by the content and its
 * dock. The page around it renders at once; the editor shows its own loading
 * and error states.
 */
export function PageEditorProvider({
  pageId,
  readOnly,
  children,
}: {
  pageId: string;
  readOnly: boolean;
  children: ReactNode;
}) {
  const state = usePageEditor(pageId, readOnly);
  const { store } = state;
  const controller = useMemo(() => (store ? new EditorController(store) : null), [store]);
  const decorations = useMemo(() => new BlockDecorations(), []);
  const previous = useRef<ReadonlyMap<string, BlockDecoration>>(new Map());
  const { user } = useOxy();
  const { t } = useTranslation();
  const profiles = useMemberProfiles(state.collaborators.map(({ userId }) => userId));
  const page = usePage(pageId);
  const theme = useEditorTheme(page.data?.page.font, page.data?.page.smallText);
  const labels = useEditorLabels();
  const [toolbarHeight, setToolbarHeight] = useState(0);
  useEffect(() => {
    const next = collaboratorDecorations(
      state.collaborators,
      user?.id,
      theme.colors,
      (id) =>
        profileName(profiles.data?.find((profile) => profile.id === id)) ??
        t('pages.info.unknownMember'),
      previous.current,
    );
    previous.current = next;
    decorations.set(next);
  }, [state.collaborators, user?.id, theme.colors, profiles.data, t, decorations]);
  const value = useMemo(
    () => ({
      ...state,
      controller,
      decorations,
      theme,
      labels,
      toolbarHeight,
      setToolbarHeight,
    }),
    [state, controller, decorations, theme, labels, toolbarHeight],
  );
  return <PageEditorContext.Provider value={value}>{children}</PageEditorContext.Provider>;
}

export function PageEditorToolbar({ readOnly }: { readOnly: boolean }) {
  const { controller, theme, labels, setToolbarHeight } = usePageEditorContext();
  if (Platform.OS === 'web' || readOnly || !controller) return null;
  return (
    <KeyboardStickyView style={{ position: 'absolute', bottom: 0, left: 0, right: 0 }}>
      <View onLayout={(event) => setToolbarHeight(event.nativeEvent.layout.height)}>
        <EditorToolbar controller={controller} theme={theme} labels={labels} mentionIndicator="@" />
      </View>
    </KeyboardStickyView>
  );
}
