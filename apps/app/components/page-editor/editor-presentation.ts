import { blockColors, type EditorLabels, type EditorTheme } from '@oxy.so/bloom-editor';
import { resolveAccentColors, useTheme } from '@oxy.so/bloom/theme';
import { useMemo } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { useColorScheme } from '@/lib/useColorScheme';
import { MONO_FONT_FAMILY } from '@/lib/fonts';

/** The editor's look, from the active Bloom theme. */
export function useEditorTheme(): EditorTheme {
  const theme = useTheme();
  const { colors, isDarkColorScheme } = useColorScheme();
  return useMemo(
    () => ({
      text: colors.foreground,
      textMuted: colors.mutedForeground,
      background: colors.background,
      border: colors.border,
      accent: colors.primary,
      accentText: colors.primaryForeground,
      selection: resolveAccentColors(theme.colors, 'primary', 'subtle').background,
      codeBackground: colors.muted,
      colors: blockColors(isDarkColorScheme ? 'dark' : 'light'),
      monoFontFamily: MONO_FONT_FAMILY,
    }),
    [colors, isDarkColorScheme, theme.colors],
  );
}

export function useEditorLabels(): EditorLabels {
  const { t, locale } = useTranslation();
  // biome-ignore lint/correctness/useExhaustiveDependencies: `locale` re-reads the catalogs.
  return useMemo(
    () => ({
      placeholder: t('editor.ui.placeholder'),
      emptyHeading: t('editor.ui.emptyHeading'),
      emptyListItem: t('editor.ui.emptyListItem'),
      emptyToggle: t('editor.ui.emptyToggle'),
      slashNoResults: t('editor.ui.slashNoResults'),
      mentionNoResults: t('editor.ui.mentionNoResults'),
      mentionSearching: t('editor.ui.mentionSearching'),
      slashGroups: {
        basic: t('editor.slashGroups.basic'),
        media: t('editor.slashGroups.media'),
        advanced: t('editor.slashGroups.advanced'),
        embeds: t('editor.slashGroups.embeds'),
        database: t('editor.slashGroups.database'),
      },
      turnInto: t('editor.ui.turnInto'),
      duplicate: t('editor.ui.duplicate'),
      delete: t('editor.ui.delete'),
      moveUp: t('editor.ui.moveUp'),
      moveDown: t('editor.ui.moveDown'),
      indent: t('editor.ui.indent'),
      outdent: t('editor.ui.outdent'),
      color: t('editor.ui.color'),
      background: t('editor.ui.background'),
      colorNames: {
        default: t('editor.colors.default'),
        gray: t('editor.colors.gray'),
        brown: t('editor.colors.brown'),
        orange: t('editor.colors.orange'),
        yellow: t('editor.colors.yellow'),
        green: t('editor.colors.green'),
        blue: t('editor.colors.blue'),
        purple: t('editor.colors.purple'),
        pink: t('editor.colors.pink'),
        red: t('editor.colors.red'),
      },
      bold: t('editor.ui.bold'),
      italic: t('editor.ui.italic'),
      underline: t('editor.ui.underline'),
      strike: t('editor.ui.strike'),
      code: t('editor.ui.code'),
      link: t('editor.ui.link'),
      linkPlaceholder: t('editor.ui.linkPlaceholder'),
      removeLink: t('editor.ui.removeLink'),
      apply: t('editor.ui.apply'),
      cancel: t('editor.ui.cancel'),
      open: t('editor.ui.open'),
      mention: t('editor.ui.mention'),
      undo: t('editor.ui.undo'),
      redo: t('editor.ui.redo'),
      formatting: t('editor.ui.formatting'),
      blockMenu: t('editor.ui.blockMenu'),
      dragHandle: t('editor.ui.dragHandle'),
      addBelow: t('editor.ui.addBelow'),
      toggleOpen: t('editor.ui.toggleOpen'),
      toggleClosed: t('editor.ui.toggleClosed'),
      checkbox: t('editor.ui.checkbox'),
    }),
    [t, locale],
  );
}
