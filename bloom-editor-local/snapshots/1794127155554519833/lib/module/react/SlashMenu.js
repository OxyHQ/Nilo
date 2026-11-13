"use strict";

import { SuggestionList } from '@oxy.so/bloom/chat-composer';
import { useMemo } from 'react';
import { filterSlashItems } from "../model/slash.js";
import { useEditorContext } from "./context.js";
import { useUi } from "./ui-store.js";

/** The editor owns the command; Bloom owns its anchored suggestion surface. */
import { jsx as _jsx } from "react/jsx-runtime";
export function SlashMenu({
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
  } = useEditorContext();
  const slash = useUi(ui, s => s.slash?.blockId === blockId ? s.slash : null);
  const matches = useMemo(() => slash ? filterSlashItems(slashItems, slash.query) : [], [slash, slashItems]);
  const suggestions = useMemo(() => matches.map(item => ({
    id: item.id,
    label: item.label,
    description: item.description,
    leading: item.leading,
    icon: item.icon,
    group: slash?.query === '' ? labels.slashGroups[item.group] ?? item.group : undefined
  })), [matches, labels.slashGroups, slash?.query]);
  if (!slash || readOnly) return null;
  return /*#__PURE__*/_jsx(SuggestionList, {
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