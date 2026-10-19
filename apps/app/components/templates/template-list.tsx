import { View } from 'react-native';
import { Button } from '@oxy.so/bloom/button';
import { EmptyState } from '@oxy.so/bloom/empty-state';
import { Item } from '@oxy.so/bloom/item';
import { Loading } from '@oxy.so/bloom/loading';
import { Text } from '@oxy.so/bloom/typography';
import { IconDisplay } from '@/components/page-chrome/icon-display';
import { useTranslation } from '@/hooks/useTranslation';
import { useTemplates } from '@/lib/hooks/use-pages';
import type { Page } from '@/lib/types/pages';

export function TemplateList({
  workspaceId,
  onUse,
  onOpen,
  pending = false,
}: {
  workspaceId: string;
  onUse: (page: Page) => void;
  onOpen?: (page: Page) => void;
  pending?: boolean;
}) {
  const { t } = useTranslation();
  const { data, isLoading, isError, refetch } = useTemplates(workspaceId);
  if (isLoading)
    return (
      <View accessibilityLiveRegion="polite" className="px-3 py-2">
        <Loading variant="inline" size="xs" text={t('common.loading')} />
      </View>
    );
  if (isError)
    return (
      <View className="px-3 py-2 gap-2 items-start">
        <Text accessibilityRole="alert" className="text-xs text-destructive">
          {t('pages.templates.loadFailed')}
        </Text>
        <Button
          appearance="plain"
          size="sm"
          accessibilityLabel={t('pages.templates.retry')}
          onPress={() => void refetch()}
        >
          {t('pages.templates.retry')}
        </Button>
      </View>
    );
  if (!data?.pages.length)
    return (
      <EmptyState
        variant="compact"
        // icon: LayoutTemplate
        title={t('pages.templates.empty')}
      />
    );
  return (
    <View accessibilityState={{ busy: pending }}>
      {data.pages.map((page) => {
        const title = page.title.trim() || t('pages.untitled');
        return (
          <View key={page.id} className="flex-row items-center gap-1 px-1">
            <View className="min-w-0 flex-1">
              <Item
                density="compact"
                accessibilityLabel={t(
                  onOpen ? 'pages.templates.open' : 'pages.templates.useNamed',
                  {
                    title,
                  },
                )}
                disabled={pending}
                onPress={() => (onOpen ? onOpen(page) : onUse(page))}
                leading={
                  <IconDisplay value={page.icon} size={16} showPlaceholder pageId={page.id} />
                }
                title={title}
              />
            </View>
            {onOpen ? (
              <Button
                appearance="plain"
                size="sm"
                accessibilityLabel={t('pages.templates.useNamed', { title })}
                disabled={pending}
                onPress={() => onUse(page)}
              >
                {t('pages.templates.use')}
              </Button>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
