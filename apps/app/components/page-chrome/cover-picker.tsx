import * as React from 'react';
import { Image, Pressable, ScrollView, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { RiDeleteBin6Line } from '@oxy.so/bloom/icons/RiDeleteBin6Line';
import { Button } from '@oxy.so/bloom/button';
import { Dialog, type DialogControlProps } from '@oxy.so/bloom/dialog';
import { EmptyState } from '@oxy.so/bloom/empty-state';
import { Loading } from '@oxy.so/bloom/loading';
import { Tabs, TabsTrigger } from '@oxy.so/bloom/tabs';
import { TextFieldInput } from '@oxy.so/bloom/text-field';
import { Text } from '@oxy.so/bloom/typography';
import { useTranslation } from '@/hooks/useTranslation';
import {
  COVER_COLORS,
  COVER_GRADIENTS,
  encodeColor,
  encodeCoverFile,
  encodeCoverImage,
  encodeGradient,
  encodeUnsplash,
} from './cover-value';
import { CoverDisplay } from './cover-display';
import { PageImageUpload } from './page-image-upload';

type Tab = 'gradient' | 'color' | 'unsplash' | 'upload' | 'link';

interface CoverPickerProps {
  /** Opened by the caller with `control.open()`; the picker closes itself. */
  control: DialogControlProps;
  /** The page whose cover this is: an uploaded image goes to it. */
  pageId: string;
  /** Called with the new encoded cover string or null to remove. */
  onSelect: (next: string | null) => void;
}

/**
 * Cover image picker. Gradient (default) | Color | Unsplash | Upload | Link.
 * Unsplash tab is gated behind `EXPO_PUBLIC_UNSPLASH_ACCESS_KEY`; without
 * one we show a friendly disabled state.
 */
export function CoverPicker({ control, pageId, onSelect }: CoverPickerProps) {
  const [tab, setTab] = React.useState<Tab>('gradient');
  const { t } = useTranslation();
  const header = React.useMemo(() => ({ title: t('pages.coverPicker.title') }), [t]);

  const handleSelect = React.useCallback(
    (next: string | null) => {
      onSelect(next);
      control.close();
    },
    [onSelect, control],
  );

  return (
    <Dialog
      control={control}
      header={header}
      label={t('pages.coverPicker.title')}
      placement={{ base: 'bottom', md: 'center' }}
      maxWidth={768}
    >
      <View className="gap-3">
        <View className="flex-row items-center gap-2">
          <View className="min-w-0 flex-1">
            <Tabs
              variant="pill"
              value={tab}
              onValueChange={(next) => setTab(next as Tab)}
              label={t('pages.coverPicker.title')}
            >
              <TabsTrigger value="gradient" label={t('pages.coverPicker.tabs.gallery')} />
              <TabsTrigger value="color" label={t('pages.coverPicker.tabs.colors')} />
              <TabsTrigger value="unsplash" label="Unsplash" />
              <TabsTrigger value="link" label={t('pages.coverPicker.tabs.link')} />
              <TabsTrigger value="upload" label={t('pages.coverPicker.tabs.upload')} />
            </Tabs>
          </View>
          <Button
            appearance="outline"
            tone="danger"
            size="sm"
            onPress={() => handleSelect(null)}
            accessibilityLabel={t('pages.coverPicker.removeCover')}
            leadingIcon={RiDeleteBin6Line}
          >
            {t('pages.coverPicker.remove')}
          </Button>
        </View>

        {tab === 'gradient' ? (
          <GradientGrid onSelect={(idx) => handleSelect(encodeGradient(idx))} />
        ) : tab === 'color' ? (
          <ColorGrid onSelect={(hex) => handleSelect(encodeColor(hex))} />
        ) : tab === 'unsplash' ? (
          <UnsplashTab onSelect={(url) => handleSelect(encodeUnsplash(url))} />
        ) : tab === 'link' ? (
          <LinkTab onSelect={(url) => handleSelect(encodeCoverImage(url))} />
        ) : (
          <PageImageUpload
            pageId={pageId}
            hint={t('pages.coverPicker.uploadHint')}
            onUploaded={(fileId) => handleSelect(encodeCoverFile(fileId))}
          />
        )}
      </View>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- *
 * Gradient tab
 * ---------------------------------------------------------------- */

function GradientGrid({ onSelect }: { onSelect: (idx: number) => void }) {
  const { t } = useTranslation();
  return (
    <ScrollView className="max-h-96">
      <View className="flex-row flex-wrap gap-2 pb-2">
        {COVER_GRADIENTS.map((g, idx) => (
          <Pressable
            key={g.name}
            onPress={() => onSelect(idx)}
            className="w-40 overflow-hidden rounded-md border border-border hover:opacity-90"
            accessibilityLabel={t('pages.coverPicker.gradientLabel', { name: g.label() })}
          >
            <CoverDisplay value={`gradient:${idx}`} height={70} preview />
            <View className="px-2 py-1">
              <Text className="text-xs text-muted-foreground">{g.label()}</Text>
            </View>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

/* ---------------------------------------------------------------- *
 * Color tab
 * ---------------------------------------------------------------- */

function ColorGrid({ onSelect }: { onSelect: (hex: string) => void }) {
  const { t } = useTranslation();
  return (
    <ScrollView className="max-h-96">
      <View className="flex-row flex-wrap gap-2 pb-2">
        {COVER_COLORS.map((c) => (
          <Pressable
            key={c.hex}
            onPress={() => onSelect(c.hex)}
            className="w-40 overflow-hidden rounded-md border border-border hover:opacity-90"
            accessibilityLabel={t('pages.coverPicker.colorLabel', { name: c.label() })}
          >
            <CoverDisplay value={`color:${c.hex}`} height={70} preview />
            <View className="px-2 py-1">
              <Text className="text-xs text-muted-foreground">{c.label()}</Text>
            </View>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

/* ---------------------------------------------------------------- *
 * Unsplash tab
 * ---------------------------------------------------------------- */

interface UnsplashImage {
  id: string;
  url: string;
  thumb: string;
  author: string;
}

async function searchUnsplash(query: string, accessKey: string): Promise<UnsplashImage[]> {
  const url = new URL('https://api.unsplash.com/search/photos');
  url.searchParams.set('query', query);
  url.searchParams.set('per_page', '24');
  url.searchParams.set('orientation', 'landscape');
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Client-ID ${accessKey}` },
  });
  if (!res.ok) throw new Error(`Unsplash ${res.status}`);
  const data: {
    results: Array<{
      id: string;
      urls: { regular: string; thumb: string };
      user: { name: string };
    }>;
  } = await res.json();
  return data.results.map((r) => ({
    id: r.id,
    url: r.urls.regular,
    thumb: r.urls.thumb,
    author: r.user.name,
  }));
}

function UnsplashTab({ onSelect }: { onSelect: (url: string) => void }) {
  const accessKey = process.env.EXPO_PUBLIC_UNSPLASH_ACCESS_KEY;
  const [query, setQuery] = React.useState('');
  const [submitted, setSubmitted] = React.useState('nature');
  const { t } = useTranslation();

  const { data, isLoading, error } = useQuery<UnsplashImage[]>({
    queryKey: ['unsplash', submitted],
    queryFn: () => {
      if (!accessKey) throw new Error('Unsplash key not configured');
      return searchUnsplash(submitted, accessKey);
    },
    enabled: Boolean(accessKey),
    staleTime: 1000 * 60 * 5,
  });

  if (!accessKey) {
    return (
      <EmptyState variant="compact" description={t('pages.coverPicker.unsplashNotConfigured')} />
    );
  }

  const handleSubmit = () => setSubmitted(query.trim() || 'nature');
  const errorMessage =
    error instanceof Error ? error.message : error ? t('pages.coverPicker.searchFailed') : null;

  return (
    <View className="gap-2">
      <View className="flex-row items-center gap-2">
        <View className="min-w-0 flex-1">
          <TextFieldInput
            size="sm"
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={handleSubmit}
            label={t('pages.coverPicker.searchUnsplash')}
            placeholder={t('pages.coverPicker.searchUnsplash')}
            autoCapitalize="none"
          />
        </View>
        <Button
          appearance="solid"
          tone="accent"
          size="sm"
          onPress={handleSubmit}
          accessibilityLabel={t('pages.coverPicker.searchUnsplash')}
        >
          {t('pages.coverPicker.search')}
        </Button>
      </View>
      {isLoading ? (
        <View className="items-center py-6">
          <Loading variant="spinner" />
        </View>
      ) : errorMessage ? (
        <Text className="px-2 py-6 text-center text-sm text-destructive">{errorMessage}</Text>
      ) : (
        <ScrollView className="max-h-80">
          <View className="flex-row flex-wrap gap-2 pb-2">
            {(data ?? []).map((img) => (
              <Pressable
                key={img.id}
                onPress={() => onSelect(img.url)}
                className="w-40 overflow-hidden rounded-md border border-border hover:opacity-90"
                accessibilityLabel={t('pages.coverPicker.photoBy', { author: img.author })}
              >
                <Image
                  source={{ uri: img.thumb }}
                  style={{ width: '100%', height: 70 }}
                  resizeMode="cover"
                />
                <View className="px-2 py-1">
                  <Text className="text-xs text-muted-foreground">{img.author}</Text>
                </View>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

/* ---------------------------------------------------------------- *
 * Link tab
 * ---------------------------------------------------------------- */

function LinkTab({ onSelect }: { onSelect: (url: string) => void }) {
  const [url, setUrl] = React.useState('');
  const { t } = useTranslation();
  return (
    <View className="gap-3 px-1 py-4">
      <Text variant="body-regular">{t('pages.coverPicker.linkHint')}</Text>
      <TextFieldInput
        size="sm"
        value={url}
        onChangeText={setUrl}
        label={t('pages.coverPicker.linkHint')}
        placeholder="https://example.com/photo.jpg"
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Button
        className="self-start"
        appearance="solid"
        tone="accent"
        onPress={() => {
          const trimmed = url.trim();
          if (!/^https?:\/\//u.test(trimmed)) return;
          onSelect(trimmed);
        }}
        accessibilityLabel={t('pages.coverPicker.useImageLink')}
      >
        {t('pages.coverPicker.useImage')}
      </Button>
    </View>
  );
}
