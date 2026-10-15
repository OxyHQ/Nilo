import { View, ActivityIndicator } from 'react-native';
import { useOxy } from '@oxy.so/services';
import * as Clipboard from 'expo-clipboard';
import { toast } from '@oxy.so/bloom/toast';
import { Text } from '@/components/ui/text';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useTranslation } from '@/hooks/useTranslation';
import { usePage } from '@/lib/hooks/use-pages';
import { usePublishPage } from '@/lib/hooks/use-page-extras';
import { hasRole } from '@/lib/hooks/workspace-roles';
import { buildPublishUrl } from './build-share-url';

export function PublishSection({ pageId }: { pageId: string }) {
  const { t } = useTranslation();
  const { user } = useOxy();
  const query = usePage(pageId);
  const page = query.data?.page;
  const publish = usePublishPage(page);
  const allowed =
    !query.isError &&
    Boolean(page && (page.ownerId === user?.id || hasRole(query.data?.role, 'admin')));
  const published = Boolean(page?.publishedAt);
  const update = (next: boolean, allowIndexing = page?.publishIndexing ?? false) =>
    publish.mutate(
      { published: next, allowIndexing },
      { onError: () => toast.error(t('pages.publish.failed')) },
    );
  return (
    <View className="rounded-xl border border-border p-3 gap-3">
      <Text accessibilityRole="header" className="text-base font-semibold">
        {t('pages.publish.title')}
      </Text>
      {query.isLoading ? <ActivityIndicator accessibilityLabel={t('common.loading')} /> : null}
      {query.isError ? (
        <Button variant="outline" onPress={() => query.refetch()}>
          <Text>{t('pages.publish.retry')}</Text>
        </Button>
      ) : null}
      <View className="flex-row items-center justify-between gap-3">
        <Text className="flex-1">{t('pages.publish.enabled')}</Text>
        <Switch
          value={published}
          onValueChange={(value) => update(value)}
          disabled={!allowed || publish.isPending}
          accessibilityLabel={t('pages.publish.enabled')}
        />
      </View>
      {!allowed && !query.isLoading ? (
        <Text className="text-sm text-muted-foreground">{t('pages.publish.noPermission')}</Text>
      ) : null}
      <Text className="text-sm text-muted-foreground">{t('pages.publish.description')}</Text>
      {published && page?.publishSlug ? (
        <View className="gap-2">
          <Text selectable className="text-sm text-muted-foreground">
            {buildPublishUrl(page.publishSlug)}
          </Text>
          <Button
            variant="outline"
            onPress={async () => {
              try {
                await Clipboard.setStringAsync(buildPublishUrl(page.publishSlug!));
                toast.success(t('pages.toasts.linkCopied'));
              } catch {
                toast.error(t('pages.publish.copyFailed'));
              }
            }}
            accessibilityLabel={t('pages.publish.copy')}
          >
            <Text>{t('pages.publish.copy')}</Text>
          </Button>
        </View>
      ) : null}
      <View className="flex-row items-center justify-between gap-3">
        <Text className="flex-1">{t('pages.publish.indexing')}</Text>
        <Switch
          value={page?.publishIndexing ?? false}
          onValueChange={(value) => update(true, value)}
          disabled={!allowed || !published || publish.isPending}
          accessibilityLabel={t('pages.publish.indexing')}
        />
      </View>
    </View>
  );
}
