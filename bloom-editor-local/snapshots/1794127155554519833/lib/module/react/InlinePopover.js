"use strict";

import { Platform, StyleSheet, Text } from 'react-native';
import { LinkButton } from '@oxy.so/bloom/button';
import { useEditorContext } from "./context.js";
import { BarButton } from "./FormatBar.js";
import { KeepFocus } from './KeepFocus';

/**
 * Under a block whose caret is at a link or a mention: where it goes and a
 * way to follow it (clicking text in an editor places the caret, it does not
 * navigate), and removing a link.
 */
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export function InlinePopover({
  target
}) {
  const {
    theme,
    labels,
    controller,
    onOpenLink,
    onOpenMention
  } = useEditorContext();
  const open = () => {
    if (target.kind === 'link') onOpenLink(target.href);else onOpenMention?.(target.mention, target.text);
  };
  const canOpen = target.kind === 'link' || onOpenMention !== undefined;
  return /*#__PURE__*/_jsxs(KeepFocus, {
    owner: controller,
    style: styles.popover,
    children: [/*#__PURE__*/_jsx(Text, {
      style: [styles.what, {
        color: theme.textMuted
      }],
      numberOfLines: 1,
      children: target.kind === 'link' ? target.href : target.text
    }), target.kind === 'link' ? /*#__PURE__*/_jsx(LinkButton, {
      href: target.href,
      accessibilityLabel: labels.open,
      onPress: event => {
        if (Platform.OS === 'web') {
          const click = event;
          if (click.metaKey || click.ctrlKey || click.shiftKey || click.altKey || click.button !== 0) return;
          click.preventDefault();
        }
        open();
      },
      children: labels.open
    }) : canOpen ? /*#__PURE__*/_jsx(BarButton, {
      label: labels.open,
      theme: theme,
      onPress: open,
      children: /*#__PURE__*/_jsx(Text, {
        style: [styles.word, {
          color: theme.accent
        }],
        children: labels.open
      })
    }) : null, target.kind === 'link' ? /*#__PURE__*/_jsx(BarButton, {
      label: labels.removeLink,
      theme: theme,
      onPress: () => controller.removeLink(),
      children: /*#__PURE__*/_jsx(Text, {
        style: [styles.word, {
          color: theme.textMuted
        }],
        children: labels.removeLink
      })
    }) : null]
  });
}
const styles = StyleSheet.create({
  popover: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4
  },
  what: {
    flexShrink: 1,
    fontSize: 13,
    marginRight: 4
  },
  word: {
    fontSize: 13
  }
});
//# sourceMappingURL=InlinePopover.js.map