import { Pressable } from 'react-native';
import { ChevronDown, ChevronRight } from 'lucide-react-native';
import { Text } from '@/components/ui/text';
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
  const Icon = expanded ? ChevronDown : ChevronRight;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      accessibilityLabel={t(
        expanded ? 'databases.subItems.collapse' : 'databases.subItems.expand',
        { title: title || t('databases.untitled') },
      )}
      onPress={(event) => {
        event.stopPropagation();
        onPress();
      }}
      className="p-1"
    >
      <Icon size={16} className="text-muted-foreground" />
    </Pressable>
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
