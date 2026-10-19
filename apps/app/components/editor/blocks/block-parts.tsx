import * as React from 'react';
import { TextInput, View } from 'react-native';
import type { BloomIconComponent } from '@oxy.so/bloom/icons';
import { TextFieldInput } from '@oxy.so/bloom/text-field';
import { Text } from '@oxy.so/bloom/typography';
import { useTranslation } from '@/hooks/useTranslation';
import { useColorScheme } from '@/lib/useColorScheme';
import { type BlockComponentProps, typedUrl } from './types';
import { useDraft } from './use-draft';

/** A media block's caption: written when it is left, read-only text for readers. */
export function BlockCaption({
  block,
  onChangeContent,
  readOnly,
}: Pick<BlockComponentProps, 'block' | 'onChangeContent' | 'readOnly'>) {
  const { t } = useTranslation();
  const { colors } = useColorScheme();
  const caption = typeof block.content.caption === 'string' ? block.content.caption : '';
  const field = useDraft(caption, (next) => onChangeContent({ ...block.content, caption: next }));
  if (readOnly) {
    return caption ? <Text className="text-xs text-muted-foreground py-1">{caption}</Text> : null;
  }
  return (
    <TextInput
      {...field}
      placeholder={t('editor.blocks.captionPlaceholder')}
      placeholderTextColor={colors.mutedForeground}
      className="text-xs text-muted-foreground py-1"
    />
  );
}

/**
 * The place of a block that has nothing to show yet. An editor pastes a link
 * into it (committed when the field is left, `typedUrl`); a reader sees only
 * what kind of block it is.
 */
export function UrlPrompt({
  icon: Icon,
  label,
  paste,
  readOnly,
  onCommit,
  children,
}: {
  icon: BloomIconComponent;
  label: string;
  paste: string;
  readOnly?: boolean;
  onCommit: (url: string) => void;
  /** More ways to fill the block (an upload), beside the field. */
  children?: React.ReactNode;
}) {
  const { colors } = useColorScheme();
  const [draft, setDraft] = React.useState('');
  return (
    <View className="rounded-lg border border-dashed border-border bg-muted/40 px-3 py-4 gap-3">
      <View className="flex-row items-center gap-2">
        <Icon width={16} height={16} fill={colors.mutedForeground} />
        <Text className="text-sm text-muted-foreground">{label}</Text>
      </View>
      {readOnly ? null : (
        <View className="flex-row items-center gap-2">
          <View className="flex-1">
            <TextFieldInput
              label={paste}
              value={draft}
              onChangeText={setDraft}
              onBlur={() => {
                const url = typedUrl(draft);
                if (url) onCommit(url);
              }}
              placeholder={paste}
            />
          </View>
          {children}
        </View>
      )}
    </View>
  );
}
