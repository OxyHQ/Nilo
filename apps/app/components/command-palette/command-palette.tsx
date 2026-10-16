import { IconDisplay } from '@/components/page-chrome/icon-display';
import { SearchSnippet } from './search-snippet';
import { SearchStatus } from './search-status';
import { searchPageHref } from './search-results';
import * as React from 'react';
import { Platform, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { RiTimeLine } from '@oxy.so/bloom/icons/RiTimeLine';
import { RiFileTextLine } from '@oxy.so/bloom/icons/RiFileTextLine';
import { Avatar } from '@oxy.so/bloom/avatar';
import { CloseButton } from '@oxy.so/bloom/button';
import { Dialog } from '@oxy.so/bloom/dialog';
import { Divider } from '@oxy.so/bloom/divider';
import { EmptyState } from '@oxy.so/bloom/empty-state';
import { Item } from '@oxy.so/bloom/item';
import { Kbd } from '@oxy.so/bloom/kbd';
import { Search } from '@oxy.so/bloom/search';
import { Text } from '@oxy.so/bloom/typography';
import { useUIStore } from '@/lib/stores/ui-store';
import { useColorScheme } from '@/lib/useColorScheme';
import { usePaletteData } from './use-palette-data';
import type { AnyCommandItem, CommandItem, MemberItem, PageItem } from './types';
import { useTranslation } from '@/hooks/useTranslation';

/** The palette card's width on wide screens, and the height its results scroll in. */
const PALETTE_MAX_WIDTH = 560;
const RESULTS_MAX_HEIGHT = 420;

interface PaletteKeyEvent {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  preventDefault: () => void;
}

/**
 * The command palette: a Bloom `Dialog` (a sheet on narrow screens, a centred
 * card on wide ones) over the workspace's pages, people and commands. It opens
 * on Cmd+K (handled by `useKeyboardShortcuts`) and from the sidebar Search
 * button.
 *
 * Bloom's `Command` is not used because its rows take a label, a string
 * description and a Bloom icon only: page icons, search snippets, the search
 * status with its retry, member avatars and Cmd+Enter are all Nilo's.
 *
 * On web the results are keyboard-driven from the search field: the arrows move
 * the highlight, Enter opens it, and Cmd+Enter opens a page in a new tab.
 */
export function CommandPalette() {
  const open = useUIStore((s) => s.commandPaletteOpen);
  const setOpen = useUIStore((s) => s.setCommandPaletteOpen);
  const router = useRouter();
  const { colors } = useColorScheme();
  const { t } = useTranslation();
  const [query, setQuery] = React.useState('');
  const [active, setActive] = React.useState(0);

  // Open fresh: reset on the closed-to-open flip, during render, so the old
  // query is never painted and the exit animation keeps the results it had.
  const [wasOpen, setWasOpen] = React.useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setQuery('');
      setActive(0);
    }
  }

  const { recents, pages, members, commands, searchLoading, searchError, retrySearch } =
    usePaletteData({ query, enabled: open });

  const close = React.useCallback(() => setOpen(false), [setOpen]);

  const openPage = React.useCallback(
    (item: PageItem, newTab = false) => {
      setOpen(false);
      if (newTab && typeof window !== 'undefined') {
        window.open(searchPageHref(item), '_blank', 'noopener,noreferrer');
        return;
      }
      router.push(searchPageHref(item));
    },
    [router, setOpen],
  );

  const select = React.useCallback(
    (item: AnyCommandItem, newTab = false) => {
      if (item.kind === 'page') openPage(item, newTab);
      // Future: jump to a member's profile / DM. Closing is all it does for now.
      else if (item.kind === 'member') close();
      else item.onSelect();
    },
    [openPage, close],
  );

  // Every result in display order; the highlight is an index into this.
  const results = React.useMemo<AnyCommandItem[]>(
    () => [...recents, ...pages, ...members, ...commands],
    [recents, pages, members, commands],
  );
  const activeIndex = Math.min(active, Math.max(0, results.length - 1));

  const changeQuery = React.useCallback((next: string) => {
    setQuery(next);
    setActive(0);
  }, []);

  const handleKeyDown = (e: PaletteKeyEvent) => {
    if (results.length === 0) return;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActive((activeIndex + 1) % results.length);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActive((activeIndex - 1 + results.length) % results.length);
        break;
      case 'Enter':
        e.preventDefault();
        select(results[activeIndex], Boolean(e.metaKey || e.ctrlKey));
        break;
    }
  };
  // The keys are typed in the search field, and react-native-web's TextInput
  // stops its own keydowns from bubbling, so the field itself must handle them.
  // On web `onKeyPress` receives the keydown event; preventing Enter's default
  // also keeps the field from blurring.
  const keyProps: Record<string, unknown> =
    Platform.OS === 'web' ? { onKeyPress: handleKeyDown } : {};

  // Keep the highlighted row inside the results viewport (web).
  const listRef = React.useRef<ScrollView | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the highlight moving is what re-runs this; the DOM carries the row.
  React.useEffect(() => {
    if (Platform.OS !== 'web') return;
    const node = (
      listRef.current as unknown as { getScrollableNode?: () => HTMLElement | null } | null
    )?.getScrollableNode?.();
    node?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({
      block: 'nearest',
    });
  }, [activeIndex]);

  // Recents reuse the page rows' objects, so a row is matched by position.
  const pagesStart = recents.length;
  const membersStart = pagesStart + pages.length;
  const commandsStart = membersStart + members.length;

  return (
    <Dialog
      open={open}
      onClose={close}
      placement={{ base: 'bottom', md: 'center' }}
      maxWidth={PALETTE_MAX_WIDTH}
      contentPadding={0}
      scrollable={false}
      label={t('commandPalette.placeholder')}
    >
      <View>
        <View className="flex-row items-center gap-2 p-3">
          <View className="flex-1">
            <Search
              label={t('commandPalette.placeholder')}
              placeholder={t('commandPalette.placeholder')}
              value={query}
              onChangeText={changeQuery}
              onClearText={() => changeQuery('')}
              autoFocus
              {...keyProps}
            />
          </View>
          <CloseButton size="sm" accessibilityLabel={t('commandPalette.close')} onPress={close} />
        </View>
        <Divider />
        <ScrollView
          ref={listRef}
          style={{ maxHeight: RESULTS_MAX_HEIGHT }}
          contentContainerClassName="p-2"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {results.length === 0 && !query.trim() ? (
            <EmptyState
              variant="compact"
              // icon: Search
              title={t('commandPalette.noResults')}
            />
          ) : null}

          {recents.length > 0 ? (
            <Group title={t('commandPalette.groups.recent')}>
              {recents.map((item, index) => (
                <PageRow
                  key={item.id}
                  item={item}
                  active={activeIndex === index}
                  onSelect={select}
                  icon={<RiTimeLine size="sm" fill={colors.mutedForeground} />}
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
              {pages.map((item, index) => (
                <PageRow
                  key={item.id}
                  item={item}
                  active={activeIndex === pagesStart + index}
                  onSelect={select}
                  icon={<RiFileTextLine size="sm" fill={colors.mutedForeground} />}
                />
              ))}
            </Group>
          ) : null}

          {members.length > 0 ? (
            <Group title={t('commandPalette.groups.people')}>
              {members.map((item, index) => (
                <MemberRow
                  key={item.id}
                  item={item}
                  active={activeIndex === membersStart + index}
                  onSelect={select}
                />
              ))}
            </Group>
          ) : null}

          {commands.length > 0 ? (
            <Group title={t('commandPalette.groups.commands')}>
              {commands.map((item, index) => (
                <CommandRow
                  key={item.id}
                  item={item}
                  active={activeIndex === commandsStart + index}
                  onSelect={select}
                />
              ))}
            </Group>
          ) : null}
        </ScrollView>
      </View>
    </Dialog>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="py-1">
      <View className="px-3 pt-2 pb-1">
        <Text className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </Text>
      </View>
      <View>{children}</View>
    </View>
  );
}

interface RowProps<T extends AnyCommandItem> {
  item: T;
  /** The keyboard highlight. */
  active: boolean;
  onSelect: (item: AnyCommandItem) => void;
}

function PageRow({ item, active, onSelect, icon }: RowProps<PageItem> & { icon: React.ReactNode }) {
  const details =
    item.subtitle || item.snippet?.length ? (
      <View>
        {item.subtitle ? (
          <Text className="text-xs text-muted-foreground" numberOfLines={1}>
            {item.subtitle}
          </Text>
        ) : null}
        <SearchSnippet parts={item.snippet} />
      </View>
    ) : undefined;
  return (
    <Item
      role="option"
      selected={active}
      density="compact"
      accessibilityLabel={item.title}
      onPress={() => onSelect(item)}
      leading={item.icon ? <IconDisplay value={item.icon} size={16} /> : icon}
      title={item.title}
      subtitle={details}
    />
  );
}

function MemberRow({ item, active, onSelect }: RowProps<MemberItem>) {
  return (
    <Item
      role="option"
      selected={active}
      density="compact"
      accessibilityLabel={item.title}
      onPress={() => onSelect(item)}
      leading={<Avatar source={item.avatar} variant="thumb" name={item.title} size={24} />}
      title={item.title}
      subtitle={item.subtitle}
    />
  );
}

function CommandRow({ item, active, onSelect }: RowProps<CommandItem>) {
  const { colors } = useColorScheme();
  const Icon = item.icon;
  return (
    <Item
      role="option"
      selected={active}
      density="compact"
      accessibilityLabel={item.title}
      onPress={() => onSelect(item)}
      leading={Icon ? <Icon width={16} height={16} fill={colors.mutedForeground} /> : undefined}
      title={item.title}
      subtitle={item.subtitle}
      trailing={item.shortcut ? <Kbd size="sm">{item.shortcut}</Kbd> : undefined}
    />
  );
}
