"use strict";

import { Platform } from 'react-native';
import { Popover, PopoverContent } from '@oxy.so/bloom/popover';
import { jsx as _jsx } from "react/jsx-runtime";
/** Editor focus ownership over the shared placement, material and dismiss owner. */
export function EditorPopover({
  open,
  anchor,
  controller,
  label,
  onDismiss,
  children
}) {
  return /*#__PURE__*/_jsx(Popover, {
    open: open,
    modal: false,
    onOpenChange: next => {
      if (next) return;
      const owned = Platform.OS === 'web' && controller.ownsControlFocus(document.activeElement);
      controller.cancelLinkEditor();
      onDismiss();
      if (owned) controller.refocus();
    },
    children: /*#__PURE__*/_jsx(PopoverContent, {
      virtualAnchor: anchor,
      side: "top",
      align: "start",
      label: label,
      minWidth: 0,
      maxWidth: 360,
      maxHeight: 320,
      children: children
    })
  });
}
//# sourceMappingURL=EditorPopover.js.map