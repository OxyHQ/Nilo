"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.SlashMenu = SlashMenu;
var _chatComposer = require("@oxy.so/bloom/chat-composer");
var _react = require("react");
var _slash = require("../model/slash.js");
var _context = require("./context.js");
var _uiStore = require("./ui-store.js");
var _jsxRuntime = require("react/jsx-runtime");
/** The editor owns the command; Bloom owns its anchored suggestion surface. */
function SlashMenu({
  blockId,
  onChoose,
  anchor,
  listboxId
}) {
  const {
    ui,
    labels,
    slashItems,
    readOnly
  } = (0, _context.useEditorContext)();
  const slash = (0, _uiStore.useUi)(ui, s => s.slash?.blockId === blockId ? s.slash : null);
  const matches = (0, _react.useMemo)(() => slash ? (0, _slash.filterSlashItems)(slashItems, slash.query) : [], [slash, slashItems]);
  const suggestions = (0, _react.useMemo)(() => matches.map(item => ({
    id: item.id,
    label: item.label,
    description: item.description,
    leading: item.leading,
    icon: item.icon,
    group: slash?.query === '' ? labels.slashGroups[item.group] ?? item.group : undefined
  })), [matches, labels.slashGroups, slash?.query]);
  if (!slash || readOnly) return null;
  return /*#__PURE__*/(0, _jsxRuntime.jsx)(_chatComposer.SuggestionList, {
    kind: "command",
    anchor: anchor,
    listboxId: listboxId,
    suggestions: suggestions,
    activeIndex: slash.highlighted,
    onActiveIndexChange: highlighted => {
      const current = ui.get().slash;
      if (current?.blockId === blockId) ui.set({
        slash: {
          ...current,
          highlighted
        }
      });
    },
    onSelectSuggestion: (_, index) => {
      const item = matches[index];
      if (item) onChoose(item);
    },
    onOpenChange: open => {
      if (!open && ui.get().slash?.blockId === blockId) ui.set({
        slash: null
      });
    },
    showEmpty: true,
    emptyLabel: labels.slashNoResults
  });
}
//# sourceMappingURL=SlashMenu.js.map