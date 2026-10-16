import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { RiDice5Line } from '@oxy.so/bloom/icons/RiDice5Line';
import { RiDeleteBin6Line } from '@oxy.so/bloom/icons/RiDeleteBin6Line';
import { Button } from '@oxy.so/bloom/button';
import { Dialog, type DialogControlProps } from '@oxy.so/bloom/dialog';
import { EmptyState } from '@oxy.so/bloom/empty-state';
import { RadioGroup } from '@oxy.so/bloom/radio';
import { Tabs, TabsTrigger } from '@oxy.so/bloom/tabs';
import { TextFieldInput } from '@oxy.so/bloom/text-field';
import { Text } from '@oxy.so/bloom/typography';
import { useColorScheme } from '@/lib/useColorScheme';
import { useTranslation } from '@/hooks/useTranslation';
import { EMOJI_CATEGORIES, SKIN_TONES, applySkinTone, type EmojiEntry } from './emoji-data';
import { PAGE_ICONS } from './page-icons';
import { encodeEmoji, encodeIcon, encodeImage } from './icon-value';

type Tab = 'emoji' | 'icon' | 'upload';

interface IconPickerProps {
  /** Opened by the caller with `control.open()`; the picker closes itself. */
  control: DialogControlProps;
  /**
   * Called with the new encoded icon string or `null` to clear it.
   * The caller (PageChrome) is responsible for persisting via useUpdatePage.
   */
  onSelect: (next: string | null) => void;
  /**
   * When the upload tab is enabled, used to lift an uploaded image URL into
   * the picker. Web-only for now; native renders a "coming soon" message.
   */
  onUploadImage?: (url: string) => void;
}

/**
 * Page icon picker. Tabs: Emoji (default) | Icon | Upload (web).
 * Layout-wise the picker fits a 672px-wide dialog.
 */
export function IconPicker({ control, onSelect, onUploadImage }: IconPickerProps) {
  const [tab, setTab] = React.useState<Tab>('emoji');
  const [query, setQuery] = React.useState('');
  const [skinTone, setSkinTone] = React.useState<string>('');
  const { t } = useTranslation();
  const header = React.useMemo(() => ({ title: t('pages.iconPicker.title') }), [t]);

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
      label={t('pages.iconPicker.title')}
      placement={{ base: 'bottom', md: 'center' }}
      maxWidth={672}
    >
      <View className="gap-3">
        {/* Tab bar + action buttons */}
        <View className="flex-row items-center gap-2">
          <View className="min-w-0 flex-1">
            <Tabs
              variant="pill"
              value={tab}
              onValueChange={(next) => setTab(next as Tab)}
              label={t('pages.iconPicker.title')}
            >
              <TabsTrigger value="emoji" label={t('pages.iconPicker.tabs.emoji')} />
              <TabsTrigger value="icon" label={t('pages.iconPicker.tabs.icon')} />
              <TabsTrigger value="upload" label={t('pages.iconPicker.tabs.upload')} />
            </Tabs>
          </View>
          <Button
            appearance="outline"
            tone="neutral"
            size="sm"
            onPress={() => handleSelect(randomEmojiEncoded())}
            accessibilityLabel={t('pages.iconPicker.randomEmoji')}
            leadingIcon={RiDice5Line}
          >
            {t('pages.iconPicker.random')}
          </Button>
          <Button
            appearance="outline"
            tone="danger"
            size="sm"
            onPress={() => handleSelect(null)}
            accessibilityLabel={t('pages.iconPicker.removeIcon')}
            leadingIcon={RiDeleteBin6Line}
          >
            {t('pages.iconPicker.remove')}
          </Button>
        </View>

        {/* Search */}
        {tab !== 'upload' ? (
          <TextFieldInput
            size="sm"
            value={query}
            onChangeText={setQuery}
            label={
              tab === 'emoji'
                ? t('pages.iconPicker.searchEmojis')
                : t('pages.iconPicker.searchIcons')
            }
            placeholder={
              tab === 'emoji'
                ? t('pages.iconPicker.searchEmojis')
                : t('pages.iconPicker.searchIcons')
            }
          />
        ) : null}

        {/* Tab body */}
        {tab === 'emoji' ? (
          <EmojiTab
            query={query}
            skinTone={skinTone}
            onChangeSkinTone={setSkinTone}
            onPickEmoji={(value) => handleSelect(encodeEmoji(value))}
          />
        ) : tab === 'icon' ? (
          <IconTab query={query} onPickIcon={(name) => handleSelect(encodeIcon(name))} />
        ) : (
          <UploadTab
            onPickImage={(url) => {
              onUploadImage?.(url);
              handleSelect(encodeImage(url));
            }}
          />
        )}
      </View>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- *
 * Emoji tab
 * ---------------------------------------------------------------- */

interface EmojiTabProps {
  query: string;
  skinTone: string;
  onChangeSkinTone: (id: string) => void;
  onPickEmoji: (value: string) => void;
}
function EmojiTab({ query, skinTone, onChangeSkinTone, onPickEmoji }: EmojiTabProps) {
  const { t } = useTranslation();
  const normalized = query.trim().toLowerCase();
  const modifier = SKIN_TONES.find((tone) => tone.id === skinTone)?.modifier ?? '';

  const filtered = React.useMemo(() => {
    if (!normalized) return EMOJI_CATEGORIES;
    return EMOJI_CATEGORIES.map((cat) => ({
      ...cat,
      emojis: cat.emojis.filter((e) => e.keywords.includes(normalized)),
    })).filter((cat) => cat.emojis.length > 0);
  }, [normalized]);

  return (
    <View className="gap-2">
      {/* Skin tone row */}
      <View className="flex-row items-center gap-1">
        <Text className="text-xs text-muted-foreground">{t('pages.iconPicker.skinTone')}</Text>
        <RadioGroup
          variant="chip"
          size="xs"
          label={t('pages.iconPicker.skinTone')}
          className="flex-row items-center gap-1"
          value={skinTone || 'default'}
          onValueChange={onChangeSkinTone}
          options={SKIN_TONES.map((tone) => ({
            value: tone.id,
            accessibilityLabel: tone.label(),
            labelContent: (
              <Text style={{ fontSize: 14 }}>{tone.modifier ? `👋${tone.modifier}` : '👋'}</Text>
            ),
          }))}
        />
      </View>

      <ScrollView
        className="max-h-80"
        showsVerticalScrollIndicator
        keyboardShouldPersistTaps="handled"
      >
        {filtered.length === 0 ? (
          <EmptyState variant="compact" title={t('pages.iconPicker.noEmojis', { query })} />
        ) : (
          filtered.map((cat) => (
            <View key={cat.id} className="pb-2">
              <Text className="px-1 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {cat.label()}
              </Text>
              <View className="flex-row flex-wrap">
                {cat.emojis.map((entry) => (
                  <EmojiCell
                    key={entry.emoji}
                    entry={entry}
                    modifier={modifier}
                    onPress={onPickEmoji}
                  />
                ))}
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

interface EmojiCellProps {
  entry: EmojiEntry;
  modifier: string;
  onPress: (value: string) => void;
}
const EmojiCell = React.memo(function EmojiCell({ entry, modifier, onPress }: EmojiCellProps) {
  const value = applySkinTone(entry, modifier);
  return (
    <Pressable
      onPress={() => onPress(value)}
      className="h-9 w-9 items-center justify-center rounded-md hover:bg-muted active:bg-muted"
      accessibilityLabel={`Emoji ${entry.keywords.split(' ')[0]}`}
    >
      <Text style={{ fontSize: 22, lineHeight: 26 }}>{value}</Text>
    </Pressable>
  );
});

/* ---------------------------------------------------------------- *
 * Icon tab (Bloom icons)
 * ---------------------------------------------------------------- */

interface IconTabProps {
  query: string;
  onPickIcon: (name: string) => void;
}
function IconTab({ query, onPickIcon }: IconTabProps) {
  const { colors } = useColorScheme();
  const { t } = useTranslation();
  const normalized = query.trim().toLowerCase();
  const filtered = React.useMemo(() => {
    if (!normalized) return PAGE_ICONS;
    return PAGE_ICONS.filter((e) => e.name.includes(normalized) || e.keywords.includes(normalized));
  }, [normalized]);

  return (
    <ScrollView
      className="max-h-80"
      showsVerticalScrollIndicator
      keyboardShouldPersistTaps="handled"
    >
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
    </ScrollView>
  );
}

/* ---------------------------------------------------------------- *
 * Upload tab
 * ---------------------------------------------------------------- */

interface UploadTabProps {
  onPickImage: (url: string) => void;
}
function UploadTab({ onPickImage }: UploadTabProps) {
  const [url, setUrl] = React.useState('');
  const { t } = useTranslation();
  // Upload-to-S3 lives behind the More Block Types agent's infra work. Until
  // that ships, accept a direct URL on web and show a friendly message on
  // native so users at least have a path.
  return (
    <View className="gap-3 px-1 py-4">
      <Text variant="body-regular">{t('pages.iconPicker.uploadHint')}</Text>
      <TextFieldInput
        size="sm"
        value={url}
        onChangeText={setUrl}
        label={t('pages.iconPicker.uploadHint')}
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
