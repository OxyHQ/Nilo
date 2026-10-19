import * as React from 'react';
import { Platform, TextInput, View } from 'react-native';
import { RiFunctions } from '@oxy.so/bloom/icons/RiFunctions';
import { Pre } from '@oxy.so/bloom/code';
import { Text } from '@oxy.so/bloom/typography';
import { useColorScheme } from '@/lib/useColorScheme';
import { useTranslation } from '@/hooks/useTranslation';
import type { BlockComponentProps } from './types';
import { useDraft } from './use-draft';

/**
 * Equation block — stores LaTeX in `content.latex`. On web we render via
 * KaTeX; the KaTeX CSS is loaded lazily on first render to avoid pulling
 * font assets into native bundles. On native we display the raw LaTeX source
 * inside a monospace box (acceptable Phase 3 behavior — full native render
 * would require WebView).
 */
export function EquationBlock({ block, onChangeContent, readOnly }: BlockComponentProps) {
  const { t } = useTranslation();
  const { colors } = useColorScheme();
  const latex = typeof block.content.latex === 'string' ? block.content.latex : '';
  const field = useDraft(latex, (next) => onChangeContent({ ...block.content, latex: next }));

  const [html, setHtml] = React.useState<string>('');
  React.useEffect(() => {
    if (Platform.OS !== 'web' || !latex) {
      setHtml('');
      return;
    }
    // Only the latest source is shown: an earlier render that finishes later
    // is dropped rather than drawn over it.
    let current = true;
    // Lazy import — keeps initial bundle slim for users who never insert math.
    import('katex').then((mod) => {
      if (!current) return;
      try {
        setHtml(
          mod.default.renderToString(latex, {
            throwOnError: false,
            displayMode: true,
            // KaTeX's default, stated because the HTML below is only safe with it:
            // untrusted commands (\href, \url, \htmlClass, ...) are refused.
            trust: false,
          }),
        );
      } catch {
        setHtml('');
      }
    });
    // Stylesheet is needed for proper typography. Inject once.
    if (typeof document !== 'undefined') {
      const id = 'katex-stylesheet';
      if (!document.getElementById(id)) {
        const link = document.createElement('link');
        link.id = id;
        link.rel = 'stylesheet';
        link.href = 'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css';
        document.head.appendChild(link);
      }
    }
    return () => {
      current = false;
    };
  }, [latex]);

  return (
    <View className="rounded-md border border-border bg-muted/30 px-3 py-2 my-1 gap-2">
      <View className="flex-row items-center gap-2">
        <RiFunctions width={14} height={14} fill={colors.mutedForeground} />
        <Text className="text-xs text-muted-foreground">{t('editor.blocks.equation.label')}</Text>
      </View>
      {readOnly ? null : (
        <TextInput
          {...field}
          placeholder={'\\frac{a}{b}'}
          placeholderTextColor={colors.mutedForeground}
          className="rounded bg-background px-2 py-1.5 text-sm text-foreground border border-input font-mono"
          multiline
          numberOfLines={2}
        />
      )}
      {Platform.OS === 'web' && html ? (
        <div
          // biome-ignore lint/security/noDangerouslySetInnerHtml: KaTeX renderToString output with trust: false, which escapes the user's LaTeX
          dangerouslySetInnerHTML={{ __html: html }}
          style={{
            color: colors.foreground,
            backgroundColor: 'transparent',
            overflowX: 'auto',
          }}
        />
      ) : Platform.OS !== 'web' && latex ? (
        <Pre>{latex}</Pre>
      ) : null}
    </View>
  );
}
