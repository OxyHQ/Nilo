import * as React from 'react';
import { Pressable, Text as NativeText, View } from 'react-native';
import { tokenColor, useCodePalette } from '@oxy.so/bloom/code';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@oxy.so/bloom/dropdown-menu';
import { Text } from '@oxy.so/bloom/typography';
import { useTranslation } from '@/hooks/useTranslation';
import {
  CODE_LANGUAGE_NAMES,
  CODE_LANGUAGES,
  type CodeLanguageId,
  codeLanguage,
  highlightCode,
} from '@/lib/code-highlight';
import { MONO_FONT_FAMILY } from '@/lib/fonts';

/** A language's name in the picker and over a code block. */
export function useLanguageName(): (language: CodeLanguageId) => string {
  const { t } = useTranslation();
  return (language) =>
    language === 'plain' ? t('editor.blocks.code.plain') : CODE_LANGUAGE_NAMES[language];
}

/**
 * A code block as it is read: its language, and its text highlighted for it,
 * drawn as native text runs (selectable on the web), coloured as the editor
 * colours it (`tokenColor`, `editor-extras.ts`).
 */
export function CodeView({
  code,
  language,
  background,
}: {
  code: string;
  language: unknown;
  /** The block's own surface, when it is not the editor's. */
  background?: string;
}) {
  const palette = useCodePalette();
  const name = useLanguageName();
  const id = codeLanguage(language);
  const lines = React.useMemo(() => highlightCode(code, id), [code, id]);
  return (
    <View className="rounded-md" style={background ? { backgroundColor: background } : undefined}>
      {id === 'plain' ? null : (
        <Text className="px-3 pt-2 text-[11px] text-muted-foreground">{name(id)}</Text>
      )}
      <NativeText
        selectable
        style={{
          fontFamily: MONO_FONT_FAMILY,
          fontSize: 13,
          lineHeight: 20,
          color: palette.plain,
          padding: 12,
        }}
      >
        {lines.map((line, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a line is its position.
          <React.Fragment key={i}>
            {i > 0 ? '\n' : null}
            {line.map((token, j) => (
              <NativeText
                // biome-ignore lint/suspicious/noArrayIndexKey: a run is its position.
                key={j}
                style={{
                  fontFamily: MONO_FONT_FAMILY,
                  color: tokenColor(token.kind, palette),
                  fontStyle: token.kind === 'comment' ? 'italic' : 'normal',
                }}
              >
                {token.text}
              </NativeText>
            ))}
          </React.Fragment>
        ))}
      </NativeText>
    </View>
  );
}
