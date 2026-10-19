import * as React from 'react';
import { Pressable, Text as NativeText, View } from 'react-native';
import { type CodePalette, type CodeTokenKind, useCodePalette } from '@oxy.so/bloom/code';
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

/** A token kind's colour; comments in the palette's quietest tone, set apart from strings. */
function colorOf(kind: CodeTokenKind, palette: CodePalette): string {
  switch (kind) {
    case 'keyword':
    case 'operator':
      return palette.keyword;
    case 'string':
    case 'attrValue':
      return palette.string;
    case 'comment':
      return palette.lineNumber;
    case 'punctuation':
      return palette.punctuation;
    case 'className':
    case 'function':
    case 'attrName':
      return palette.className;
    case 'constant':
      return palette.constant;
    default:
      return palette.plain;
  }
}

/** A language's name in the picker and over a code block. */
export function useLanguageName(): (language: CodeLanguageId) => string {
  const { t } = useTranslation();
  return (language) =>
    language === 'plain' ? t('editor.blocks.code.plain') : CODE_LANGUAGE_NAMES[language];
}

/**
 * A code block as it is read: its language, and its text highlighted for it,
 * drawn as native text runs (selectable on the web).
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
                  color: colorOf(token.kind, palette),
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

/**
 * The language of a code block an editor is writing in: a short tag beside
 * the code that opens the list of languages.
 */
export function CodeLanguagePicker({
  language,
  onChange,
}: {
  language: unknown;
  onChange: (language: CodeLanguageId) => void;
}) {
  const { t } = useTranslation();
  const name = useLanguageName();
  const id = codeLanguage(language);
  const label = t('editor.blocks.code.language', { language: name(id) });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          hitSlop={6}
          className="items-center justify-center rounded px-0.5 py-1 hover:bg-muted active:bg-muted"
        >
          <Text
            className="text-[9px] font-semibold uppercase text-muted-foreground"
            numberOfLines={1}
          >
            {SHORT[id]}
          </Text>
        </Pressable>
      </DropdownMenuTrigger>
      <DropdownMenuContent label={label}>
        {CODE_LANGUAGES.map((option) => (
          <DropdownMenuCheckboxItem
            key={option}
            checked={option === id}
            onCheckedChange={() => onChange(option)}
          >
            {name(option)}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** What fits in the narrow column beside a code block. */
const SHORT: Record<CodeLanguageId, string> = {
  plain: 'txt',
  javascript: 'js',
  typescript: 'ts',
  json: '{}',
  python: 'py',
  bash: 'sh',
  sql: 'sql',
  css: 'css',
  html: '</>',
  markdown: 'md',
  yaml: 'yml',
  go: 'go',
  rust: 'rs',
  java: 'java',
  c: 'c',
  cpp: 'c++',
  csharp: 'c#',
  php: 'php',
  ruby: 'rb',
  swift: 'swift',
  kotlin: 'kt',
};
