"use strict";

import { useCallback, useRef } from 'react';
import { View } from 'react-native';

/**
 * Controls that act on the text being edited. In a browser, pressing a button
 * moves focus to it — the editor loses its selection before the button runs —
 * so the press's default (`mousedown` focusing) is prevented, as every web
 * editor's toolbar does. Text fields inside still take focus.
 */
import { jsx as _jsx } from "react/jsx-runtime";
export function KeepFocus({
  children,
  style,
  owner
}) {
  const previous = useRef(null);
  const attach = useCallback(node => {
    if (previous.current) owner?.controlHosts.delete(previous.current);
    previous.current = node;
    if (node) owner?.controlHosts.add(node);
  }, [owner]);
  return (
    /*#__PURE__*/
    // biome-ignore lint/a11y/noStaticElementInteractions: not a control; it keeps the buttons inside from taking focus.
    _jsx("div", {
      role: "presentation",
      style: {
        display: 'contents'
      },
      onMouseDown: event => {
        const target = event.target;
        if (!target.closest('input, textarea, [contenteditable="true"]')) event.preventDefault();
      },
      children: /*#__PURE__*/_jsx(View, {
        ref: attach,
        style: style,
        children: children
      })
    })
  );
}
//# sourceMappingURL=KeepFocus.web.js.map