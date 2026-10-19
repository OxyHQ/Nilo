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
  useSyncExternalStore,
} from 'react';
import { Button } from '@oxy.so/bloom/button';
import { RiChat3Line } from '@oxy.so/bloom/icons/RiChat3Line';
import { selectionAnchor } from '@/lib/comments/anchor';
import type { CommentAnchor } from '@/lib/types/comments';
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
import { collaboratorDecorations, withCommentDecorations } from './presence';
import { usePageComments } from '@/lib/hooks/use-comments';
import { openCommentCounts } from '@/components/comments/comment-indicator';

type EditorContextValue = PageEditorState & {
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
  useEffect(() => {
    const carets = collaboratorDecorations(
      state.collaborators,
      user?.id,
      theme.colors,
      (id) =>
        profileName(profiles.data?.find((profile) => profile.id === id)) ??
        t('pages.info.unknownMember'),
      previous.current,
    );
    const next = withCommentDecorations(
      carets,
      commentCounts,
      theme.colors.yellow?.text ?? theme.accent,
      (count) => t('comments.indicator.count', { count }),
      previous.current,
    );
    previous.current = next;
    decorations.set(next);
  }, [
    state.collaborators,
    user?.id,
    theme.colors,
    theme.accent,
    profiles.data,
    t,
    decorations,
    commentCounts,
  ]);
  const value = useMemo(
    () => ({
      ...state,
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
    [state, controller, decorations, theme, labels, toolbarHeight, aiTarget, embeddedController],
  );
  return <PageEditorContext.Provider value={value}>{children}</PageEditorContext.Provider>;
}

/** The page editor's state, or null outside a page (a synced block drawn elsewhere). */
export function useOptionalPageEditorContext() {
  return useContext(PageEditorContext);
}

export function PageEditorToolbar({
  readOnly,
  onComment,
}: {
  readOnly: boolean;
  /** Comment on the selected text; without it the toolbar offers no comment. */
  onComment?: (blockId: string, anchor: CommentAnchor) => void;
}) {
  const { controller, embeddedController, theme, labels, setToolbarHeight } =
    usePageEditorContext();
  if (Platform.OS === 'web' || readOnly || !controller) return null;
  // A synced block being edited has the keyboard: its editor's toolbar.
  const active = embeddedController ?? controller;
  return (
    <KeyboardStickyView style={{ position: 'absolute', bottom: 0, left: 0, right: 0 }}>
      <View onLayout={(event) => setToolbarHeight(event.nativeEvent.layout.height)}>
        {onComment && active === controller ? (
          <CommentOnSelection controller={controller} onComment={onComment} />
        ) : null}
        <EditorToolbar controller={active} theme={theme} labels={labels} mentionIndicator="@" />
      </View>
    </KeyboardStickyView>
  );
}

/**
 * Touch devices: "Comment" over the toolbar while text is selected (the web
 * has the shortcut and the block's menu). Bloom's toolbar takes no actions of
 * an app's own, so it is drawn beside it.
 */
function CommentOnSelection({
  controller,
  onComment,
}: {
  controller: EditorController;
  onComment: (blockId: string, anchor: CommentAnchor) => void;
}) {
  const { t } = useTranslation();
  const focused = useSyncExternalStore(controller.ui.subscribe, () => controller.ui.get().focused);
  const key = useSyncExternalStore(controller.store.subscribe, () => {
    const selection = controller.textSelection;
    return selection && selection.start !== selection.end
      ? `${selection.blockId}:${selection.start}:${selection.end}`
      : null;
  });
  if (!focused || !key) return null;
  return (
    <View className="flex-row justify-end border-t border-border bg-background px-2 py-1">
      <Button
        appearance="subtle"
        size="sm"
        leadingIcon={RiChat3Line}
        onPress={() => {
          const selected = selectionAnchor(controller.store);
          if (selected) onComment(selected.blockId, selected.anchor);
        }}
      >
        {t('editor.ui.comment')}
      </Button>
    </View>
  );
}
