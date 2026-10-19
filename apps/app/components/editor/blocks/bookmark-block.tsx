import * as React from 'react';
import { Platform, Pressable, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { useQuery } from '@tanstack/react-query';
import { RiLinkM } from '@oxy.so/bloom/icons/RiLinkM';
import { TextFieldInput } from '@oxy.so/bloom/text-field';
import { Text } from '@oxy.so/bloom/typography';
import { useColorScheme } from '@/lib/useColorScheme';
import { fetchEmbedPreview } from '@/lib/embed-preview';
import { type BlockComponentProps, blockUrl, typedUrl } from './types';

/**
 * Bookmark block — once a URL is set, fetches OG metadata from
 * `/embed/preview` (via React Query so callers benefit from the cache) and
 * stores the title/description/image/favicon on `content` so the card
 * renders without re-fetching on every paint.
 */
export function BookmarkBlock({ block, onChangeContent }: BlockComponentProps) {
  const { colors } = useColorScheme();
  const url = blockUrl(block.content.url);
  const title = typeof block.content.title === 'string' ? block.content.title : '';
  const description =
    typeof block.content.description === 'string' ? block.content.description : '';
  const image = blockUrl(block.content.image);
  const favicon = blockUrl(block.content.favicon);

  // Reset the draft when the block id changes (effectively "key-based reset").
  const [urlDraft, setUrlDraft] = React.useState(url);
  const lastBlockId = React.useRef(block.id);
  if (lastBlockId.current !== block.id) {
    lastBlockId.current = block.id;
    setUrlDraft(url);
  }

  const hasMetadata = Boolean(title || description || image);
  const preview = useQuery({
    queryKey: ['embed-preview', url],
    queryFn: () => fetchEmbedPreview(url),
    enabled: Boolean(url) && !hasMetadata,
    staleTime: 1000 * 60 * 30,
  });

  // Persist fetched metadata back onto the block's content, once per
  // (url, fetch result) pair — after the render that saw it, never during it.
  const fetched = preview.data;
  const lastWrittenUrl = React.useRef<string | null>(hasMetadata ? url : null);
  const content = React.useRef(block.content);
  content.current = block.content;
  React.useEffect(() => {
    if (!fetched || hasMetadata || lastWrittenUrl.current === fetched.url) return;
    lastWrittenUrl.current = fetched.url;
    onChangeContent({
      ...content.current,
      url,
      title: fetched.title,
      description: fetched.description,
      image: fetched.image,
      favicon: fetched.favicon,
    });
  }, [fetched, hasMetadata, url, onChangeContent]);

  const commitUrl = (next: string) => {
    const trimmed = typedUrl(next);
    if (trimmed === url) return;
    lastWrittenUrl.current = null;
    onChangeContent({
      ...block.content,
      url: trimmed,
      title: undefined,
      description: undefined,
      image: undefined,
      favicon: undefined,
    });
  };

  if (!url) {
    return (
      <View className="rounded-lg border border-dashed border-border bg-muted/40 px-3 py-4 gap-3">
        <View className="flex-row items-center gap-2">
          <RiLinkM size="sm" fill={colors.mutedForeground} />
          <Text className="text-sm text-muted-foreground">Bookmark</Text>
        </View>
        <TextFieldInput
          label="Paste any URL"
          value={urlDraft}
          onChangeText={setUrlDraft}
          onBlur={() => commitUrl(urlDraft)}
          placeholder="Paste any URL"
        />
      </View>
    );
  }

  const loading = preview.isFetching && !title;

  const cardBody = (
    <View className="flex-row gap-3 rounded-lg border border-border bg-muted/30 overflow-hidden">
      <View className="flex-1 px-3 py-2 gap-1">
        <Text variant="body-medium" numberOfLines={2}>
          {loading ? 'Loading…' : title || url}
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
