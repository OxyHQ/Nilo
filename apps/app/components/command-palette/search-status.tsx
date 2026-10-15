import { Pressable, View } from 'react-native';
import { Text } from '@/components/ui/text';
import { useTranslation } from '@/hooks/useTranslation';

export function SearchStatus({
  loading,
  error,
  empty,
  retry,
}: {
  loading: boolean;
  error: boolean;
  empty: boolean;
  retry: () => void;
}) {
  const { t } = useTranslation();
  if (!loading && !error && !empty) return null;
  return (
    <View className="px-3 py-2" accessibilityLiveRegion="polite">
      <Text className="text-xs text-muted-foreground">
        {t(
          loading
            ? 'commandPalette.search.loading'
            : error
              ? 'commandPalette.search.error'
              : 'commandPalette.search.empty',
        )}
      </Text>
      {error && !loading ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('commandPalette.search.retry')}
          onPress={retry}
          className="self-start rounded-md py-2 hover:bg-muted"
        >
          <Text className="text-sm text-primary">{t('commandPalette.search.retry')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
