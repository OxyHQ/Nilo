import { Platform, Pressable, View } from 'react-native';
import { RiFileTextLine } from '@oxy.so/bloom/icons/RiFileTextLine';
import { Text } from '@oxy.so/bloom/typography';
import { useTranslation } from '@/hooks/useTranslation';
import { useColorScheme } from '@/lib/useColorScheme';
import { UrlPrompt } from './block-parts';
import type { BlockComponentProps } from './types';

/**
 * PDF block — embeds the PDF in an iframe on web, links out on native.
 * Falls back to a download pill if the iframe load fails (we can't tell
 * from JS whether the iframe succeeded, so we always show a small "Open in
 * new tab" link alongside it). The iframe is not sandboxed: Chrome refuses
 * to show a PDF in a sandboxed frame, and `blockContent` already keeps out any
 * URL that is not a page's to load.
 */
export function PdfBlock({ block, onChangeContent, readOnly }: BlockComponentProps) {
  const { t } = useTranslation();
  const { colors } = useColorScheme();
  const url = block.content.url ?? '';

  if (!url) {
    return (
      <UrlPrompt
        icon={RiFileTextLine}
        label={t('editor.blocks.pdf.label')}
        paste={t('editor.blocks.pdf.paste')}
        readOnly={readOnly}
        onCommit={(next) => onChangeContent({ ...block.content, url: next })}
      />
    );
  }

  if (Platform.OS === 'web') {
    return (
      <View className="gap-1">
        <View style={{ width: '100%', aspectRatio: 4 / 5 }}>
          <iframe
            src={url}
            title={t('editor.blocks.pdf.preview')}
            style={{
              border: 0,
              width: '100%',
              height: '100%',
              borderRadius: 8,
            }}
          />
        </View>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          style={{ fontSize: 12 }}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          {t('editor.blocks.pdf.openInNewTab')}
        </a>
      </View>
    );
  }

  return (
    <Pressable
      onPress={() => import('expo-web-browser').then((mod) => mod.openBrowserAsync(url))}
      className="flex-row items-center gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2"
    >
      <RiFileTextLine width={18} height={18} fill={colors.foreground} />
      <Text variant="body-regular">{t('editor.blocks.pdf.open')}</Text>
    </Pressable>
  );
}
