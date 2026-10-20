import * as React from 'react';
import { Platform, Pressable, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { useQuery } from '@tanstack/react-query';
import { RiLinkM } from '@oxy.so/bloom/icons/RiLinkM';
import { Text } from '@oxy.so/bloom/typography';
import { useTranslation } from '@/hooks/useTranslation';
import { fetchEmbedPreview } from '@/lib/embed-preview';
import { UrlPrompt } from './block-parts';
import type { BlockComponentProps } from './types';

/**
 * Bookmark block — once a URL is set, fetches OG metadata from
 * `/embed/preview` (via React Query so callers benefit from the cache) and
 * stores the title/description/image/favicon on `content` so the card
 * renders without re-fetching on every paint.
 */
export function BookmarkBlock({ block, onChangeContent, readOnly }: BlockComponentProps) {
  const { t } = useTranslation();
  const url = block.content.url ?? '';
  const title = typeof block.content.title === 'string' ? block.content.title : '';
  const description =
    typeof block.content.description === 'string' ? block.content.description : '';
  const image = block.content.image ?? '';
  const favicon = block.content.favicon ?? '';

  const hasMetadata = Boolean(title || description || image);
  const preview = useQuery({
    queryKey: ['embed-preview', url],
    queryFn: () => fetchEmbedPreview(url),
    // A reader shows what the block holds; only an editor fetches and stores it.
    enabled: Boolean(url) && !hasMetadata && !readOnly,
    staleTime: 1000 * 60 * 30,
  });

  // Persist fetched metadata back onto the block's content, once per
  // (url, fetch result) pair — after the render that saw it, never during it.
  const fetched = preview.data;
  const lastWrittenUrl = React.useRef<string | null>(hasMetadata ? url : null);
  const content = React.useRef(block.content);
  content.current = block.content;
  React.useEffect(() => {
    if (!fetched || hasMetadata || readOnly || lastWrittenUrl.current === fetched.url) return;
    lastWrittenUrl.current = fetched.url;
    onChangeContent({
      ...content.current,
      url,
      title: fetched.title,
      description: fetched.description,
      image: fetched.image,
      favicon: fetched.favicon,
    });
  }, [fetched, hasMetadata, readOnly, url, onChangeContent]);

  if (!url) {
    return (
      <UrlPrompt
        icon={RiLinkM}
        label={t('editor.blocks.bookmark.label')}
        paste={t('editor.blocks.bookmark.paste')}
        readOnly={readOnly}
        onCommit={(next) => {
          lastWrittenUrl.current = null;
          onChangeContent({
            ...block.content,
            url: next,
            title: undefined,
            description: undefined,
            image: undefined,
            favicon: undefined,
          });
        }}
      />
    );
  }

  const loading = preview.isFetching && !title;

  const cardBody = (
    <View className="flex-row gap-3 rounded-lg border border-border bg-muted/30 overflow-hidden">
      <View className="flex-1 px-3 py-2 gap-1">
        <Text variant="body-medium" numberOfLines={2}>
          {loading ? t('editor.blocks.loading') : title || url}
        </Text>
        {description ? (
          <Text className="text-xs text-muted-foreground" numberOfLines={2}>
            {description}
          </Text>
        ) : null}
        <View className="flex-row items-center gap-1 mt-1">
          {favicon ? (
            <ExpoImage
              source={{ uri: favicon }}
              style={{ width: 12, height: 12 }}
              contentFit="contain"
            />
          ) : null}
          <Text className="text-xs text-muted-foreground" numberOfLines={1}>
            {url}
          </Text>
        </View>
      </View>
      {image ? (
        <ExpoImage source={{ uri: image }} style={{ width: 96, height: 80 }} contentFit="cover" />
      ) : null}
    </View>
  );

  if (Platform.OS === 'web') {
    return (
      <a href={url} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
        {cardBody}
      </a>
    );
  }

  return (
    <Pressable onPress={() => import('expo-web-browser').then((mod) => mod.openBrowserAsync(url))}>
      {cardBody}
    </Pressable>
  );
}
