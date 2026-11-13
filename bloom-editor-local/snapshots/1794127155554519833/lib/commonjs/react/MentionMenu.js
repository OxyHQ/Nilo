"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.MentionMenu = MentionMenu;
exports.mentionSuggestionId = mentionSuggestionId;
var _chatComposer = require("@oxy.so/bloom/chat-composer");
var _context = require("./context.js");
var _uiStore = require("./ui-store.js");
var _jsxRuntime = require("react/jsx-runtime");
/** The same shared suggestion renderer, with application-provided mention results. */
function MentionMenu({
  blockId,
  onChoose,
  anchor,
  listboxId
}) {
  const {
    ui,
    labels,
    readOnly
  } = (0, _context.useEditorContext)();
  const mention = (0, _uiStore.useUi)(ui, s => s.mention?.blockId === blockId ? s.mention : null);
  if (!mention || readOnly) return null;
  return /*#__PURE__*/(0, _jsxRuntime.jsx)(_chatComposer.SuggestionList, {
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
function mentionSuggestionId(item) {
  return JSON.stringify([item.group ?? '', item.id]);
}
//# sourceMappingURL=MentionMenu.js.map