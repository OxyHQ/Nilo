import * as React from 'react';
import { View } from 'react-native';
import { EmojiPicker } from '@oxy.so/bloom/chat-composer';
import { ResponsiveGrid } from '@oxy.so/bloom/grid';
import { RiDice5Line } from '@oxy.so/bloom/icons/RiDice5Line';
import { RiDeleteBin6Line } from '@oxy.so/bloom/icons/RiDeleteBin6Line';
import { Button } from '@oxy.so/bloom/button';
import { Dialog, type DialogControlProps } from '@oxy.so/bloom/dialog';
import { EmptyState } from '@oxy.so/bloom/empty-state';
import { TextFieldInput } from '@oxy.so/bloom/text-field';
import { Text } from '@oxy.so/bloom/typography';
import { useTranslation } from '@/hooks/useTranslation';
import { EMOJI_CATEGORIES, SKIN_TONE_LABELS } from './emoji-data';
import { PAGE_ICONS } from './page-icons';
import { encodeEmoji, encodeIcon, encodeIconFile, encodeImage } from './icon-value';
import { PageImageUpload } from './page-image-upload';

type Tab = '__emoji' | 'icon' | 'upload';

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
 * Layout-wise the picker fits a 672px-wide dialog.
 */
export function IconPicker({
  control,
  onSelect,
  pageId,
  variant = 'page',
  title: givenTitle,
}: IconPickerProps) {
  const [tab, setTab] = React.useState<Tab>('__emoji');
  const [query, setQuery] = React.useState('');
  const [emojiQuery, setEmojiQuery] = React.useState('');
  const { t } = useTranslation();
  const title = givenTitle ?? t('pages.iconPicker.title');
  const header = React.useMemo(() => ({ title }), [title]);
  const callout = variant === 'callout';

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
      label={title}
      placement={{ base: 'bottom', md: 'center' }}
      maxWidth={672}
    >
      <View className="gap-3">
        <View className="flex-row flex-wrap items-center justify-end gap-2">
          <Button
            appearance="outline"
            tone="neutral"
            onPress={() => handleSelect(randomEmojiEncoded())}
            accessibilityLabel={t('pages.iconPicker.randomEmoji')}
            leadingIcon={RiDice5Line}
          >
            {t('pages.iconPicker.random')}
          </Button>
          {callout ? null : (
            <Button
              appearance="outline"
              tone="danger"
              onPress={() => handleSelect(null)}
              accessibilityLabel={t('pages.iconPicker.removeIcon')}
              leadingIcon={RiDeleteBin6Line}
            >
              {t('pages.iconPicker.remove')}
            </Button>
          )}
        </View>

        <EmojiPicker
          embedded
          scrollable={false}
          columns="auto"
          query={emojiQuery}
          onQueryChange={setEmojiQuery}
          skinToneLabel={(tone) => SKIN_TONE_LABELS[tone]()}
          groups={EMOJI_CATEGORIES.map((category) => ({
            key: category.id,
            label: category.label(),
            emojis: category.emojis.map((entry) => ({
              char: entry.emoji,
              name: entry.keywords,
              keywords: entry.keywords.split(' '),
            })),
          }))}
          activeTab={callout && tab === 'upload' ? '__emoji' : tab}
          onActiveTabChange={(next) => {
            if (next === '__emoji' || next === 'icon' || (!callout && next === 'upload'))
              setTab(next);
          }}
          onSelectEmoji={(emoji) => handleSelect(encodeEmoji(emoji))}
          accessibilityLabel={title}
          labels={{
            emojiTab: t('pages.iconPicker.tabs.emoji'),
            search: t('pages.iconPicker.searchEmojis'),
            skinTone: t('pages.iconPicker.skinTone'),
            empty: t('pages.iconPicker.noEmojis', { query: emojiQuery }),
          }}
          tabs={[
            {
              key: 'icon',
              label: t('pages.iconPicker.tabs.icon'),
              content: (
                <View className="gap-3">
                  <TextFieldInput
                    value={query}
                    onChangeText={setQuery}
                    label={t('pages.iconPicker.searchIcons')}
                    placeholder={t('pages.iconPicker.searchIcons')}
                  />
                  <IconTab query={query} onPickIcon={(name) => handleSelect(encodeIcon(name))} />
                </View>
              ),
            },
            ...(!callout
              ? [
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
                ]
              : []),
          ]}
        />
      </View>
    </Dialog>
  );
}

interface IconTabProps {
  query: string;
  onPickIcon: (name: string) => void;
}
function IconTab({ query, onPickIcon }: IconTabProps) {
  const { t } = useTranslation();
  const normalized = query.trim().toLowerCase();
  const filtered = React.useMemo(() => {
    if (!normalized) return PAGE_ICONS;
    return PAGE_ICONS.filter((e) => e.name.includes(normalized) || e.keywords.includes(normalized));
  }, [normalized]);

  return filtered.length === 0 ? (
    <EmptyState variant="compact" title={t('pages.iconPicker.noIcons', { query })} />
  ) : (
    <ResponsiveGrid minItemWidth={44} maxColumns={12} gap={4}>
      {filtered.map((entry) => (
        <Button
          key={entry.name}
          appearance="plain"
          tone="neutral"
          iconOnly
          icon={entry.Icon}
          onPress={() => onPickIcon(entry.name)}
          accessibilityLabel={entry.name}
        />
      ))}
    </ResponsiveGrid>
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
