import * as React from 'react';
import { Pressable, View } from 'react-native';
import { RiDice5Line } from '@oxy.so/bloom/icons/RiDice5Line';
import { RiDeleteBin6Line } from '@oxy.so/bloom/icons/RiDeleteBin6Line';
import { Button } from '@oxy.so/bloom/button';
import { EmojiPicker, type EmojiGroup } from '@oxy.so/bloom/chat-composer';
import { Dialog, type DialogControlProps } from '@oxy.so/bloom/dialog';
import { EmptyState } from '@oxy.so/bloom/empty-state';
import { TextFieldInput } from '@oxy.so/bloom/text-field';
import { Text } from '@oxy.so/bloom/typography';
import { useColorScheme } from '@/lib/useColorScheme';
import { useTranslation } from '@/hooks/useTranslation';
import { EMOJI_CATEGORIES } from './emoji-data';
import { PAGE_ICONS } from './page-icons';
import { encodeEmoji, encodeIcon, encodeIconFile, encodeImage } from './icon-value';
import { PageImageUpload } from './page-image-upload';

interface IconPickerProps {
  /** Opened by the caller with `control.open()`; the picker closes itself. */
  control: DialogControlProps;
  /**
   * Called with the new encoded icon string or `null` to clear it.
   * The caller (PageChrome) is responsible for persisting via useUpdatePage.
   */
  onSelect: (next: string | null) => void;
  /**
   * The page whose icon this is: an uploaded image goes to it. Without one
   * (a full-page database's icon) an image is taken by link only.
   */
  pageId?: string;
  /**
   * `callout`: a callout's icon, which is always one (no removing it) and an
   * emoji or an icon (no upload: an image would belong to the page, not the
   * block, and a callout copied elsewhere would lose it).
   */
  variant?: 'page' | 'callout';
  /** The title above the picker; the page icon's by default. */
  title?: string;
}

/**
 * Page icon picker. Tabs: Emoji (default) | Icon | Upload (an image file, or
 * a link to one).
 * Bloom owns emoji rendering, filtering and tones. The dialog owns material
 * and overflow; its embedded picker and product tabs stay in that scroll flow.
 */
export function IconPicker({
  control,
  onSelect,
  pageId,
  variant = 'page',
  title: givenTitle,
}: IconPickerProps) {
  const { t } = useTranslation();
  const title = givenTitle ?? t('pages.iconPicker.title');
  const callout = variant === 'callout';
  const groups: EmojiGroup[] = EMOJI_CATEGORIES.map((category) => ({
    key: category.id,
    label: category.label(),
    emojis: category.emojis.map((entry) => ({
      char: entry.emoji,
      name: entry.keywords.split(' ')[0],
      keywords: entry.keywords.split(' '),
    })),
  }));

  const handleSelect = React.useCallback(
    (next: string | null) => {
      onSelect(next);
      control.close();
    },
    [onSelect, control],
  );

  const header = React.useMemo(
    () => ({
      title,
      largeTitle: false,
      actions: [
        {
          icon: RiDice5Line,
          accessibilityLabel: t('pages.iconPicker.randomEmoji'),
          onPress: () => handleSelect(randomEmojiEncoded()),
        },
        ...(callout
          ? []
          : [
              {
                icon: RiDeleteBin6Line,
                accessibilityLabel: t('pages.iconPicker.removeIcon'),
                onPress: () => handleSelect(null),
              },
            ]),
      ],
    }),
    [title, t, callout, handleSelect],
  );

  return (
    <Dialog
      control={control}
      header={header}
      label={title}
      placement={{ base: 'bottom', md: 'center' }}
      maxWidth={672}
    >
      <EmojiPicker
        embedded
        scrollable={false}
        groups={groups}
        onSelectEmoji={(value) => handleSelect(encodeEmoji(value))}
        tabs={[
          {
            key: 'icon',
            label: t('pages.iconPicker.tabs.icon'),
            content: <IconTab onPickIcon={(name) => handleSelect(encodeIcon(name))} />,
          },
          ...(callout
            ? []
            : [
                {
                  key: 'upload',
                  label: t('pages.iconPicker.tabs.upload'),
                  content: (
                    <UploadTab
                      pageId={pageId}
                      onUploaded={(fileId) => handleSelect(encodeIconFile(fileId))}
                      onPickImage={(url) => handleSelect(encodeImage(url))}
                    />
                  ),
                },
              ]),
        ]}
      />
    </Dialog>
  );
}

/* ---------------------------------------------------------------- *
 * Icon tab (Bloom icons)
 * ---------------------------------------------------------------- */

interface IconTabProps {
  onPickIcon: (name: string) => void;
}
function IconTab({ onPickIcon }: IconTabProps) {
  const [query, setQuery] = React.useState('');
  const { colors } = useColorScheme();
  const { t } = useTranslation();
  const normalized = query.trim().toLowerCase();
  const filtered = React.useMemo(() => {
    if (!normalized) return PAGE_ICONS;
    return PAGE_ICONS.filter((e) => e.name.includes(normalized) || e.keywords.includes(normalized));
  }, [normalized]);

  return (
    <View className="gap-3">
      <TextFieldInput
        value={query}
        onChangeText={setQuery}
        label={t('pages.iconPicker.searchIcons')}
        placeholder={t('pages.iconPicker.searchIcons')}
      />
      <View>
        {filtered.length === 0 ? (
          <EmptyState variant="compact" title={t('pages.iconPicker.noIcons', { query })} />
        ) : (
          <View className="flex-row flex-wrap pb-2">
            {filtered.map((entry) => {
              const Icon = entry.Icon;
              return (
                <Pressable
                  key={entry.name}
                  onPress={() => onPickIcon(entry.name)}
                  className="h-9 w-9 items-center justify-center rounded-md hover:bg-muted active:bg-muted"
                  accessibilityLabel={entry.name}
                >
                  <Icon width={18} height={18} fill={colors.foreground} />
                </Pressable>
              );
            })}
          </View>
        )}
      </View>
    </View>
  );
}

/* ---------------------------------------------------------------- *
 * Upload tab
 * ---------------------------------------------------------------- */

interface UploadTabProps {
  pageId?: string;
  onUploaded: (fileId: string) => void;
  onPickImage: (url: string) => void;
}
function UploadTab({ pageId, onUploaded, onPickImage }: UploadTabProps) {
  const [url, setUrl] = React.useState('');
  const { t } = useTranslation();
  return (
    <View className="gap-3 px-1 py-4">
      {pageId ? (
        <PageImageUpload
          pageId={pageId}
          hint={t('pages.iconPicker.uploadHint')}
          onUploaded={onUploaded}
        />
      ) : null}
      <Text variant="body-regular">{t('pages.iconPicker.linkHint')}</Text>
      <TextFieldInput
        size="sm"
        value={url}
        onChangeText={setUrl}
        label={t('pages.iconPicker.linkHint')}
        placeholder="https://example.com/icon.png"
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
          onPickImage(trimmed);
        }}
        accessibilityLabel={t('pages.iconPicker.useImage')}
      >
        {t('pages.iconPicker.useImage')}
      </Button>
    </View>
  );
}

/* ---------------------------------------------------------------- *
 * Random emoji helper
 * ---------------------------------------------------------------- */

function randomEmojiEncoded(): string {
  const pool = EMOJI_CATEGORIES.flatMap((c) => c.emojis);
  const entry = pool[Math.floor(Math.random() * pool.length)];
  return encodeEmoji(entry.emoji);
}
