import { View } from 'react-native';
import { RiRefreshLine } from '@oxy.so/bloom/icons/RiRefreshLine';
import { Text } from '@oxy.so/bloom/typography';
import { useTranslation } from '@/hooks/useTranslation';
import { useColorScheme } from '@/lib/useColorScheme';
import type { BlockComponentProps } from './types';

/**
 * A synced block's place. The block type is stored so imported pages keep
 * their references; showing the source's content here is not built yet, and
 * the slash menu does not offer the block.
 */
export function SyncBlock(_props: BlockComponentProps) {
  const { t } = useTranslation();
  const { colors } = useColorScheme();
  return (
    <View className="flex-row items-center gap-2 rounded-md border border-dashed border-border bg-muted/30 px-3 py-2">
      <RiRefreshLine width={14} height={14} fill={colors.mutedForeground} />
      <Text className="text-sm text-muted-foreground">{t('editor.blocks.syncBlock.label')}</Text>
    </View>
  );
}
