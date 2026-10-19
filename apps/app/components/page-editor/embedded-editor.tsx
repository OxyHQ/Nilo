/**
 * What a page's editor hands the editors drawn inside it — a synced block
 * showing another page's (or this page's) original, edited in place over
 * that page's own store (`components/editor/blocks/sync-block.tsx`): the
 * page's menus, theme and mentions, the renderers for the shown page, and
 * which of those editors has the keyboard, for the toolbar drawn above it on
 * touch devices.
 */
import type {
  BlockRenderer,
  EditorController,
  EditorLabels,
  EditorStore,
  EditorTheme,
  MentionSource,
  SlashItem,
} from '@oxy.so/bloom-editor';
import type { MentionMark } from '@oxy.so/bloom-text/model';
import { createContext, type ReactNode, useContext, useEffect } from 'react';

export interface EmbeddedEditorValue {
  slashItems: readonly SlashItem[];
  markers: Readonly<Record<string, BlockRenderer>>;
  theme: EditorTheme;
  labels: EditorLabels;
  mentions?: MentionSource;
  onOpenMention?: (mention: MentionMark, text: string) => void;
  onOpenLink: (href: string) => void;
  /** Renderers for blocks of `pageId`, over its `store`. */
  renderersFor: (
    pageId: string,
    store: EditorStore,
    readOnly: boolean,
  ) => Record<string, BlockRenderer>;
  /** An embedded editor took the keyboard (or gave it back: null). */
  setActiveController: (
    update: (current: EditorController | null) => EditorController | null,
  ) => void;
}

const EmbeddedEditorContext = createContext<EmbeddedEditorValue | null>(null);

export function EmbeddedEditorProvider({
  value,
  children,
}: {
  value: EmbeddedEditorValue;
  children: ReactNode;
}) {
  return <EmbeddedEditorContext.Provider value={value}>{children}</EmbeddedEditorContext.Provider>;
}

/** The page editor's context for an editor inside it; null outside a page editor. */
export function useEmbeddedEditor(): EmbeddedEditorValue | null {
  return useContext(EmbeddedEditorContext);
}

/**
 * The slash items an embedded editor offers: blocks, and the containers it
 * can make itself — not what needs the page around it (a subpage, a
 * database) or another synced block inside one.
 */
export const EMBEDDED_CUSTOM_ITEMS = new Set(['columns', 'table']);
export function embeddedSlashItems(items: readonly SlashItem[]): SlashItem[] {
  return items.filter(
    (item) => item.action.kind !== 'custom' || EMBEDDED_CUSTOM_ITEMS.has(item.action.id),
  );
}

/** Tell the page which embedded editor has the keyboard (or the link field). */
export function useActiveEmbeddedController(controller: EditorController | null): void {
  const embedded = useEmbeddedEditor();
  const setActive = embedded?.setActiveController;
  useEffect(() => {
    if (!controller || !setActive) return;
    const { ui } = controller;
    let active = false;
    const update = () => {
      const state = ui.get();
      const now = state.focused !== null || state.linking !== null;
      if (now === active) return;
      active = now;
      setActive((current) => (now ? controller : current === controller ? null : current));
    };
    update();
    const stop = ui.subscribe(update);
    return () => {
      stop();
      setActive((current) => (current === controller ? null : current));
    };
  }, [controller, setActive]);
}
