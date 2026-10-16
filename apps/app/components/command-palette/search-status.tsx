import { View } from 'react-native';
import { Button } from '@oxy.so/bloom/button';
import { EmptyState } from '@oxy.so/bloom/empty-state';
import { Loading } from '@oxy.so/bloom/loading';
import { Text } from '@oxy.so/bloom/typography';
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
      {loading ? (
        <Loading variant="inline" size="xs" text={t('commandPalette.search.loading')} />
      ) : error ? (
        <View className="items-start gap-1">
          <Text className="text-xs text-muted-foreground">{t('commandPalette.search.error')}</Text>
          <Button
            appearance="plain"
            size="sm"
            accessibilityLabel={t('commandPalette.search.retry')}
            onPress={retry}
          >
            {t('commandPalette.search.retry')}
          </Button>
        </View>
      ) : (
        <EmptyState
          variant="compact"
          // icon: SearchX
          title={t('commandPalette.search.empty')}
        />
      )}
    </View>
  );
}
