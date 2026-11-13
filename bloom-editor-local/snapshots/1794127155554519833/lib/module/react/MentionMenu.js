"use strict";

import { SuggestionList } from '@oxy.so/bloom/chat-composer';
import { useEditorContext } from "./context.js";
import { useUi } from "./ui-store.js";

/** The same shared suggestion renderer, with application-provided mention results. */
import { jsx as _jsx } from "react/jsx-runtime";
export function MentionMenu({
  blockId,
  onChoose,
  anchor,
  listboxId
}) {
  const {
    ui,
    labels,
    readOnly
  } = useEditorContext();
  const mention = useUi(ui, s => s.mention?.blockId === blockId ? s.mention : null);
  if (!mention || readOnly) return null;
  return /*#__PURE__*/_jsx(SuggestionList, {
    kind: "mention",
    anchor: anchor,
    listboxId: listboxId,
    suggestions: mention.items.map(item => ({
      ...item,
      id: mentionSuggestionId(item)
    })),
    activeIndex: mention.highlighted,
    onActiveIndexChange: highlighted => {
      const current = ui.get().mention;
      if (current?.blockId === blockId) ui.set({
        mention: {
          ...current,
          highlighted
        }
      });
    },
    onSelectSuggestion: (_, index) => {
      const item = mention.items[index];
      if (item) onChoose(item);
    },
    onOpenChange: open => {
      if (!open && ui.get().mention?.blockId === blockId) ui.set({
        mention: null
      });
    },
    loading: mention.loading,
    loadingLabel: labels.mentionSearching,
    showEmpty: true,
    emptyLabel: labels.mentionNoResults
  });
}

/** A person and a page may have the same ID; keep their option IDs distinct. */
export function mentionSuggestionId(item) {
  return JSON.stringify([item.group ?? '', item.id]);
}
//# sourceMappingURL=MentionMenu.js.map