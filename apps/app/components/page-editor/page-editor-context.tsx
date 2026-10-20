import {
  createContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
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
import { useOxy } from '@oxy.so/services/ui/client';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import { useTranslation } from '@/hooks/useTranslation';
import { usePageEditor, type PageEditorState } from '@/lib/editor/use-page-editor';
import { profileName, useMemberProfiles } from '@/lib/hooks/use-member-profiles';
import { useEditorTheme, useEditorLabels } from './editor-presentation';
import type { AiTarget } from './ai-dialog';
import { collaboratorDecorations, redrawOnChange, withCommentDecorations } from './presence';
import { commentHighlights } from '@/lib/comments/anchor';
import { relativeToSelection } from '@oxy.so/bloom-editor/yjs';
import { usePageComments } from '@/lib/hooks/use-comments';
import { openCommentCounts } from '@/components/comments/comment-indicator';

type EditorContextValue = PageEditorState & {
  /** The page's content is read, not edited (`pageContentReadOnly`). */
  readOnly: boolean;
  /** Null until the page's blocks have loaded (or when they failed: `error`). */
  controller: EditorController | null;
  decorations: BlockDecorations;
  theme: EditorTheme;
  labels: EditorLabels;
  toolbarHeight: number;
  setToolbarHeight: (height: number) => void;
  /** What the AI dialog works on, when it is open (`ai-dialog.tsx`). */
  aiTarget: AiTarget | null;
  setAiTarget: (target: AiTarget | null) => void;
  /**
   * The editor inside the page that has the keyboard (a synced block's,
   * `embedded-editor.tsx`), for the toolbar; null when it is the page's own.
   */
  embeddedController: EditorController | null;
  setEmbeddedController: Dispatch<SetStateAction<EditorController | null>>;
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
  const [aiTarget, setAiTarget] = useState<AiTarget | null>(null);
  const [embeddedController, setEmbeddedController] = useState<EditorController | null>(null);
  const comments = usePageComments(pageId);
  const commentCounts = useMemo(
    () => openCommentCounts(comments.data?.comments ?? []),
    [comments.data?.comments],
  );
  // Who is where, and the text open comments are on, drawn on the page's
  // blocks, and placed again as the text changes.
  const { collaborators, doc } = state;
  const commentList = comments.data?.comments;
  useEffect(() => {
    const nameOf = (id: string) =>
      profileName(profiles.data?.find((profile) => profile.id === id)) ??
      t('pages.info.unknownMember');
    const commentColor = theme.colors.yellow;
    const update = () => {
      const carets = collaboratorDecorations(
        collaborators,
        user?.id,
        theme.colors,
        nameOf,
        previous.current,
        (selection) => (doc ? relativeToSelection(doc, selection) : null),
      );
      const next = withCommentDecorations(
        carets,
        commentCounts,
        commentColor?.text ?? theme.accent,
        (count) => t('comments.indicator.count', { count }),
        previous.current,
        store ? commentHighlights(store, commentList ?? []) : [],
        commentColor?.background ?? theme.selection,
      );
      previous.current = next;
      decorations.set(next);
    };
    return redrawOnChange(store, update);
  }, [
    collaborators,
    doc,
    store,
    user?.id,
    theme.colors,
    theme.accent,
    theme.selection,
    profiles.data,
    t,
    decorations,
    commentCounts,
    commentList,
  ]);
  const value = useMemo(
    () => ({
      ...state,
      readOnly,
      controller,
      decorations,
      theme,
      labels,
      toolbarHeight,
      setToolbarHeight,
      aiTarget,
      setAiTarget,
      embeddedController,
      setEmbeddedController,
    }),
    [
      state,
      readOnly,
      controller,
      decorations,
      theme,
      labels,
      toolbarHeight,
      aiTarget,
      embeddedController,
    ],
  );
  return <PageEditorContext.Provider value={value}>{children}</PageEditorContext.Provider>;
}

/** The page editor's state, or null outside a page (a synced block drawn elsewhere). */
export function useOptionalPageEditorContext() {
  return useContext(PageEditorContext);
}

/**
 * Touch devices: Bloom's toolbar over the keyboard, for the editor that has
 * it. The page's own controller carries its format actions ("Comment" on the
 * selected text, `page-editor.tsx`), which the toolbar shows while text is
 * selected.
 */
export function PageEditorToolbar() {
  const { readOnly, controller, embeddedController, theme, labels, setToolbarHeight } =
    usePageEditorContext();
  if (Platform.OS === 'web' || readOnly || !controller) return null;
  // A synced block being edited has the keyboard: its editor's toolbar.
  const active = embeddedController ?? controller;
  return (
    <KeyboardStickyView style={{ position: 'absolute', bottom: 0, left: 0, right: 0 }}>
      <View onLayout={(event) => setToolbarHeight(event.nativeEvent.layout.height)}>
        <EditorToolbar controller={active} theme={theme} labels={labels} mentionIndicator="@" />
      </View>
    </KeyboardStickyView>
  );
}
