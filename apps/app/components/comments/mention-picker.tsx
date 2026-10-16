import * as React from 'react';
import { Platform, ScrollView, View } from 'react-native';
import { RiCalendarLine } from '@oxy.so/bloom/icons/RiCalendarLine';
import { RiFileTextLine } from '@oxy.so/bloom/icons/RiFileTextLine';
import { RiUserLine } from '@oxy.so/bloom/icons/RiUserLine';
import { EmptyState } from '@oxy.so/bloom/empty-state';
import { Item } from '@oxy.so/bloom/item';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@oxy.so/bloom/popover';
import { useColorScheme } from '@/lib/useColorScheme';
import { memberProfileName, useWorkspaceMembers } from '@/lib/hooks/use-workspace-members';
import { usePages } from '@/lib/hooks/use-pages';
import type { MentionKind, MentionSegment } from '@/lib/types/comments';
import { useTranslation } from '@/hooks/useTranslation';

interface MentionPickerProps {
  open: boolean;
  query: string;
  workspaceId: string;
  onSelect: (segment: MentionSegment) => void;
  onClose: () => void;
}

interface PickerItem {
  key: string;
  kind: MentionKind;
  /** Display label (e.g. "Nate Isern", "My Project", "Today"). */
  label: string;
  /** Secondary text (email, page path, formatted date). */
  detail?: string;
  build: () => MentionSegment;
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDisplayDate(d: Date): string {
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Mention picker — autocomplete shown when the user types `@` inside an
 * editable surface (comment composer today; editor v2 wires it in later).
 *
 * Source data:
 *   - People: workspace members (via `useWorkspaceMembers`)
 *   - Pages: workspace pages (via `usePages`)
 *   - Dates: deterministic options (Today, Tomorrow, Next week) — natural
 *     language parsing lives outside the picker for now.
 *
 * Filtering is local; the lists are small enough that we don't need server
 * search yet. When the workspace grows past a few hundred entries, swap the
 * client-side filter for a debounced server query.
 */
export function MentionPicker({ open, query, workspaceId, onSelect, onClose }: MentionPickerProps) {
  const { colors } = useColorScheme();
  const { t } = useTranslation();
  const { data: members } = useWorkspaceMembers(workspaceId);
  const { data: pagesData } = usePages(workspaceId);

  const items = React.useMemo<PickerItem[]>(() => {
    const q = query.trim().toLowerCase();

    const people: PickerItem[] = (members ?? []).map((m) => {
      const label = memberProfileName(m) ?? m.userId;
      const detail = m.user?.email ?? m.user?.username ?? undefined;
      return {
        key: `user:${m.userId}`,
        kind: 'user',
        label,
        detail,
        build: (): MentionSegment => ({
          type: 'mention',
          kind: 'user',
          id: m.userId,
          originalText: `@${label}`,
        }),
      };
    });

    const pages: PickerItem[] = (pagesData?.pages ?? [])
      .filter((p) => !p.archived)
      .map((p) => {
        const title = p.title?.trim() || t('comments.mentions.untitled');
        return {
          key: `page:${p.id}`,
          kind: 'page',
          label: title,
          detail: p.icon
            ? t('comments.mentions.pageWithIcon', { icon: p.icon })
            : t('comments.mentions.page'),
          build: (): MentionSegment => ({
            type: 'mention',
            kind: 'page',
            id: p.id,
            originalText: `@${title}`,
          }),
        };
      });

    const today = new Date();
    const tomorrow = new Date();
    tomorrow.setDate(today.getDate() + 1);
    const nextWeek = new Date();
    nextWeek.setDate(today.getDate() + 7);

    const dates: PickerItem[] = [
      { id: 'today', label: t('comments.mentions.today'), d: today },
      { id: 'tomorrow', label: t('comments.mentions.tomorrow'), d: tomorrow },
      { id: 'nextWeek', label: t('comments.mentions.nextWeek'), d: nextWeek },
    ].map(({ id, label, d }) => ({
      key: `date:${id}`,
      kind: 'date',
      label,
      detail: formatDisplayDate(d),
      build: (): MentionSegment => ({
        type: 'mention',
        kind: 'date',
        date: formatDate(d),
        originalText: `@${label}`,
      }),
    }));

    const all = [...people, ...pages, ...dates];
    if (!q) return all.slice(0, 12);
    return all
      .filter((item) => {
        return item.label.toLowerCase().includes(q) || item.detail?.toLowerCase().includes(q);
      })
      .slice(0, 12);
  }, [members, pagesData?.pages, query, t]);

  if (!open) return null;

  const renderIcon = (kind: MentionKind) => {
    if (kind === 'user') return <RiUserLine size="sm" fill={colors.foreground} />;
    if (kind === 'page') return <RiFileTextLine size="sm" fill={colors.foreground} />;
    return <RiCalendarLine size="sm" fill={colors.foreground} />;
  };

  return (
    // Not modal: the user keeps typing and clicking in the composer while the
    // picker is open, and a backdrop would swallow that first click.
    <Popover
      open
      modal={false}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      {/* The picker opens from typing `@`, not from a press, so its trigger is
          only the anchor the web panel measures: an empty box under the
          composer's input, hidden from assistive technology. */}
      <PopoverTrigger asChild>
        <View aria-hidden importantForAccessibility="no-hide-descendants" />
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        label={t('comments.mentions.header')}
        className={Platform.OS === 'web' ? 'w-72' : undefined}
      >
        <PopoverTitle tone="secondary">{t('comments.mentions.header')}</PopoverTitle>
        <ScrollView className="max-h-72" keyboardShouldPersistTaps="handled">
          {items.length === 0 ? (
            <EmptyState
              variant="compact"
              description={t('comments.mentions.noMatches', { query })}
            />
          ) : (
            items.map((item) => (
              <Item
                key={item.key}
                role="option"
                density="compact"
                onPress={() => onSelect(item.build())}
                leading={
                  <View className="h-8 w-8 items-center justify-center rounded-md bg-muted">
                    {renderIcon(item.kind)}
                  </View>
                }
                title={item.label}
                subtitle={item.detail}
              />
            ))
          )}
        </ScrollView>
      </PopoverContent>
    </Popover>
  );
}
