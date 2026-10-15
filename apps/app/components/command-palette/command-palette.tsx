import { IconDisplay } from '@/components/page-chrome/icon-display';
import { SearchSnippet } from './search-snippet';
import { SearchStatus } from './search-status';
import { searchPageHref } from './search-results';
import * as React from 'react';
import {
  Modal,
  View,
  Pressable,
  ScrollView,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Search, FileText, Clock, X } from 'lucide-react-native';
import { Text } from '@/components/ui/text';
import { useUIStore } from '@/lib/stores/ui-store';
import { useColorScheme } from '@/lib/useColorScheme';
import { usePaletteData } from './use-palette-data';
import type { PageItem, MemberItem, CommandItem } from './types';
import { useTranslation } from '@/hooks/useTranslation';

/**
 * Native command palette — bottom sheet variant with the same item set as the
 * web modal. The web build resolves `command-palette.web.tsx`; this file is
 * the iOS/Android implementation.
 */
export function CommandPalette() {
  const open = useUIStore((s) => s.commandPaletteOpen);
  const setOpen = useUIStore((s) => s.setCommandPaletteOpen);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useColorScheme();
  const { t } = useTranslation();

  const [query, setQuery] = React.useState('');

  React.useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const { recents, pages, members, commands, searchLoading, searchError, retrySearch } =
    usePaletteData({ query, enabled: open });

  const openPage = React.useCallback(
    (item: PageItem) => {
      setOpen(false);
      router.push(searchPageHref(item));
    },
    [router, setOpen],
  );

  const hasResults =
    recents.length > 0 || pages.length > 0 || members.length > 0 || commands.length > 0;

  return (
    <Modal
      visible={open}
      transparent
      animationType="slide"
      onRequestClose={() => setOpen(false)}
      statusBarTranslucent
    >
      <Pressable className="flex-1 bg-black/50" onPress={() => setOpen(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          className="flex-1 justify-end"
        >
          <Pressable
            onPress={(e) => e.stopPropagation()}
            className="rounded-t-3xl bg-background"
            style={{ maxHeight: '85%', paddingBottom: insets.bottom }}
          >
            {/* Drag handle */}
            <View className="items-center pt-2 pb-1">
              <View className="h-1 w-12 rounded-full bg-muted-foreground/30" />
            </View>

            {/* Search input */}
            <View className="flex-row items-center gap-2 px-4 pb-3 pt-1">
              <Search size={16} color={colors.mutedForeground} />
              <TextInput
                accessibilityLabel={t('commandPalette.placeholder')}
                autoFocus
                value={query}
                onChangeText={setQuery}
                placeholder={t('commandPalette.placeholder')}
                placeholderTextColor={colors.mutedForeground}
                className="flex-1 text-base text-foreground"
                returnKeyType="search"
              />
              <Pressable
                onPress={() => setOpen(false)}
                accessibilityRole="button"
                accessibilityLabel={t('commandPalette.close')}
                className="h-8 w-8 items-center justify-center rounded-full"
              >
                <X size={16} color={colors.mutedForeground} />
              </Pressable>
            </View>

            <View className="h-px bg-border" />

            <ScrollView
              className="flex-1"
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {!hasResults && !query.trim() ? (
                <View className="px-4 py-10">
                  <Text className="text-center text-sm text-muted-foreground">
                    {t('commandPalette.noResults')}
                  </Text>
                </View>
              ) : null}

              {recents.length > 0 ? (
                <Group title={t('commandPalette.groups.recent')}>
                  {recents.map((item) => (
                    <PageRow
                      key={item.id}
                      item={item}
                      onPress={openPage}
                      leadingIcon={<Clock size={14} color={colors.mutedForeground} />}
                    />
                  ))}
                </Group>
              ) : null}

              {pages.length > 0 || query.trim() ? (
                <Group title={t('commandPalette.groups.pages')}>
                  {query.trim() ? (
                    <SearchStatus
                      loading={searchLoading}
                      error={searchError}
                      empty={pages.length === 0}
                      retry={retrySearch}
                    />
                  ) : null}
                  {pages.map((item) => (
                    <PageRow key={item.id} item={item} onPress={openPage} />
                  ))}
                </Group>
              ) : null}

              {members.length > 0 ? (
                <Group title={t('commandPalette.groups.people')}>
                  {members.map((item) => (
                    <MemberRow key={item.id} item={item} />
                  ))}
                </Group>
              ) : null}

              {commands.length > 0 ? (
                <Group title={t('commandPalette.groups.commands')}>
                  {commands.map((item) => (
                    <CommandRow key={item.id} item={item} />
                  ))}
                </Group>
              ) : null}

              <View style={{ height: 16 }} />
            </ScrollView>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="px-2 py-1">
      <View className="px-3 pt-3 pb-1">
        <Text className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </Text>
      </View>
      <View>{children}</View>
    </View>
  );
}

interface PageRowProps {
  item: PageItem;
  onPress: (item: PageItem) => void;
  leadingIcon?: React.ReactNode;
}

function PageRow({ item, onPress, leadingIcon }: PageRowProps) {
  const { colors } = useColorScheme();
  return (
    <Pressable
      onPress={() => onPress(item)}
      accessibilityRole="button"
      accessibilityLabel={item.title}
      className="flex-row items-center gap-3 rounded-lg px-3 py-2 active:bg-muted"
    >
      <View className="h-6 w-6 items-center justify-center">
        {item.icon ? (
          <IconDisplay value={item.icon} size={16} />
        ) : (
          (leadingIcon ?? <FileText size={14} color={colors.mutedForeground} />)
        )}
      </View>
      <View className="flex-1">
        <Text className="text-sm text-foreground" numberOfLines={1}>
          {item.title}
        </Text>
        {item.subtitle ? (
          <Text className="text-xs text-muted-foreground" numberOfLines={1}>
            {item.subtitle}
          </Text>
        ) : null}
        <SearchSnippet parts={item.snippet} />
      </View>
    </Pressable>
  );
}

function MemberRow({ item }: { item: MemberItem }) {
  const initial = (item.title?.[0] ?? '?').toUpperCase();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={item.title}
      className="flex-row items-center gap-3 rounded-lg px-3 py-2 active:bg-muted"
    >
      <View className="h-6 w-6 items-center justify-center rounded-full bg-muted">
        <Text className="text-[10px] font-semibold text-muted-foreground">{initial}</Text>
      </View>
      <View className="flex-1">
        <Text className="text-sm text-foreground" numberOfLines={1}>
          {item.title}
        </Text>
        {item.subtitle ? (
          <Text className="text-xs text-muted-foreground" numberOfLines={1}>
            {item.subtitle}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function CommandRow({ item }: { item: CommandItem }) {
  const { colors } = useColorScheme();
  const Icon = item.icon;
  return (
    <Pressable
      onPress={() => item.onSelect()}
      accessibilityRole="button"
      accessibilityLabel={item.title}
      className="flex-row items-center gap-3 rounded-lg px-3 py-2 active:bg-muted"
    >
      <View className="h-6 w-6 items-center justify-center">
        {Icon ? <Icon size={16} color={colors.mutedForeground} /> : null}
      </View>
      <View className="flex-1">
        <Text className="text-sm text-foreground" numberOfLines={1}>
          {item.title}
        </Text>
        {item.subtitle ? (
          <Text className="text-xs text-muted-foreground" numberOfLines={1}>
            {item.subtitle}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}
