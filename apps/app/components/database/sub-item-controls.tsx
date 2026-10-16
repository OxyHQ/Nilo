import { Pressable } from 'react-native';
import { RiArrowDownSLine } from '@oxy.so/bloom/icons/RiArrowDownSLine';
import { RiArrowRightSLine } from '@oxy.so/bloom/icons/RiArrowRightSLine';
import { Button } from '@oxy.so/bloom/button';
import { Text } from '@oxy.so/bloom/typography';
import { useTranslation } from '@/hooks/useTranslation';

export function SubItemToggle({
  expanded,
  title,
  onPress,
}: {
  expanded: boolean;
  title: string;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const Icon = expanded ? RiArrowDownSLine : RiArrowRightSLine;
  return (
    <Button
      iconOnly
      appearance="plain"
      size="xs"
      // The toggle sits inside the row's own pressable, which opens the row.
      stopPropagation
      aria-expanded={expanded}
      accessibilityLabel={t(
        expanded ? 'databases.subItems.collapse' : 'databases.subItems.expand',
        { title: title || t('databases.untitled') },
      )}
      onPress={onPress}
      leadingIcon={Icon}
    />
  );
}

export function NewSubItem({
  depth,
  disabled,
  onPress,
}: {
  depth: number;
  disabled: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('databases.subItems.new')}
      disabled={disabled}
      onPress={onPress}
      style={{ paddingLeft: 16 + depth * 24 }}
      className="py-2 hover:bg-muted"
    >
      <Text className="text-sm text-muted-foreground">{t('databases.subItems.new')}</Text>
    </Pressable>
  );
}
