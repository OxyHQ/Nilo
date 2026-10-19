import * as React from 'react';
import { Platform, TextInput, View } from 'react-native';
import { RiFlowChart } from '@oxy.so/bloom/icons/RiFlowChart';
import { Pre } from '@oxy.so/bloom/code';
import { Text } from '@oxy.so/bloom/typography';
import { useColorScheme } from '@/lib/useColorScheme';
import { useTranslation } from '@/hooks/useTranslation';
import type { BlockComponentProps } from './types';
import { useDraft } from './use-draft';

let mermaidLoader: Promise<typeof import('mermaid')> | null = null;
function loadMermaid(): Promise<typeof import('mermaid')> {
  if (Platform.OS !== 'web') {
    return Promise.reject(new Error('Mermaid web-only'));
  }
  if (!mermaidLoader) {
    mermaidLoader = import('mermaid').then((mod) => {
      // 'strict' encodes HTML in labels and disables click handlers. The
      // source is page content any editor can write and every reader renders,
      // so 'loose' would let one member run script in another's session.
      mod.default.initialize({ startOnLoad: false, securityLevel: 'strict' });
      return mod;
    });
  }
  return mermaidLoader;
}

/**
 * Mermaid block — stores diagram source in `content.code`. On web we render
 * via mermaid.js (lazy-loaded). On native we show the raw code; native
 * rendering would need WebView (Phase 4).
 */
export function MermaidBlock({ block, onChangeContent, readOnly }: BlockComponentProps) {
  const { t } = useTranslation();
  const { colors } = useColorScheme();
  const code = typeof block.content.code === 'string' ? block.content.code : '';
  const field = useDraft(code, (next) => onChangeContent({ ...block.content, code: next }));

  const [svg, setSvg] = React.useState<string>('');
  const [renderError, setRenderError] = React.useState<string>('');
  const idRef = React.useRef(`mermaid-${Math.random().toString(36).slice(2)}`);

  React.useEffect(() => {
    if (Platform.OS !== 'web' || !code.trim()) {
      setSvg('');
      setRenderError('');
      return;
    }
    // Only the latest source is drawn: an earlier render finishing later is dropped.
    let current = true;
    loadMermaid()
      .then(async (mod) => {
        try {
          const { svg: rendered } = await mod.default.render(idRef.current, code);
          if (!current) return;
          setSvg(rendered);
          setRenderError('');
        } catch (err) {
          if (!current) return;
          setRenderError(
            t('editor.blocks.mermaid.renderFailed', {
              message: err instanceof Error ? err.message : '',
            }),
          );
          setSvg('');
        }
      })
      .catch(() => {
        if (current) setRenderError(t('editor.blocks.mermaid.unavailable'));
      });
    return () => {
      current = false;
    };
  }, [code, t]);

  return (
    <View className="rounded-md border border-border bg-muted/30 px-3 py-2 my-1 gap-2">
      <View className="flex-row items-center gap-2">
        <RiFlowChart width={14} height={14} fill={colors.mutedForeground} />
        <Text className="text-xs text-muted-foreground">{t('editor.blocks.mermaid.label')}</Text>
      </View>
      {readOnly ? null : (
        <TextInput
          {...field}
          placeholder={'graph TD;\n  A-->B;'}
          placeholderTextColor={colors.mutedForeground}
          className="rounded bg-background px-2 py-1.5 text-sm text-foreground border border-input font-mono"
          multiline
          numberOfLines={4}
        />
      )}
      {Platform.OS === 'web' && svg ? (
        // biome-ignore lint/security/noDangerouslySetInnerHtml: Mermaid's render output under securityLevel 'strict', which DOMPurify-sanitizes the SVG
        <div dangerouslySetInnerHTML={{ __html: svg }} style={{ overflowX: 'auto' }} />
      ) : null}
      {Platform.OS === 'web' && renderError ? (
        <Text className="text-xs text-destructive">{renderError}</Text>
      ) : null}
      {Platform.OS !== 'web' && code ? <Pre>{code}</Pre> : null}
    </View>
  );
}
