"use strict";

import { useCallback, useRef } from 'react';
import { View } from 'react-native';

/**
 * Controls that act on the text being edited. Native: pressing a button does
 * not take the keyboard from the input, so this is a plain view.
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
  return /*#__PURE__*/_jsx(View, {
    ref: attach,
    style: style,
    children: children
  });
}
//# sourceMappingURL=KeepFocus.js.map