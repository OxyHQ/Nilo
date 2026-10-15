import { Pressable, View } from 'react-native';
import { Text } from '@/components/ui/text';
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
      <Text accessibilityLiveRegion="polite" className="px-3 py-2 text-xs text-muted-foreground">
        {t('common.loading')}
      </Text>
    );
  if (isError)
    return (
      <View className="px-3 py-2 gap-2">
        <Text accessibilityRole="alert" className="text-xs text-destructive">
          {t('pages.templates.loadFailed')}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('pages.templates.retry')}
          onPress={() => void refetch()}
          className="rounded-md py-2 hover:bg-muted"
        >
          <Text className="text-sm text-primary">{t('pages.templates.retry')}</Text>
        </Pressable>
      </View>
    );
  if (!data?.pages.length)
    return (
      <Text className="px-3 py-2 text-xs text-muted-foreground">{t('pages.templates.empty')}</Text>
    );
  return (
    <View accessibilityState={{ busy: pending }}>
      {data.pages.map((page) => {
        const title = page.title.trim() || t('pages.untitled');
        return (
          <View key={page.id} className="flex-row items-center gap-1 px-1">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t(onOpen ? 'pages.templates.open' : 'pages.templates.useNamed', {
                title,
              })}
              disabled={pending}
              onPress={() => (onOpen ? onOpen(page) : onUse(page))}
              className="min-w-0 flex-1 flex-row items-center gap-2 rounded-md px-2 py-2 hover:bg-muted active:bg-muted"
            >
              <IconDisplay value={page.icon} size={16} showPlaceholder />
              <Text numberOfLines={1} className="flex-1 text-sm text-foreground">
                {title}
              </Text>
            </Pressable>
            {onOpen ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('pages.templates.useNamed', { title })}
                disabled={pending}
                onPress={() => onUse(page)}
                className="rounded-md px-2 py-2 hover:bg-muted active:bg-muted"
              >
                <Text className="text-xs font-medium text-primary">{t('pages.templates.use')}</Text>
              </Pressable>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
