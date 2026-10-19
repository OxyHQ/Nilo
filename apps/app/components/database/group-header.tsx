import * as React from 'react';
import { Pressable } from 'react-native';
import { RiArrowDownSLine } from '@oxy.so/bloom/icons/RiArrowDownSLine';
import { RiArrowRightSLine } from '@oxy.so/bloom/icons/RiArrowRightSLine';
import { Chip } from '@oxy.so/bloom/chip';
import { Text } from '@oxy.so/bloom/typography';
import { useTranslation } from '@/hooks/useTranslation';
import { useColorScheme } from '@/lib/useColorScheme';
import type { DatabaseProperty, DateGroupGranularity } from '@/lib/types/databases';
import { dateGroupLabel } from '@/lib/view-groups';
import { PersonChips } from './person-cell';
import { SELECT_CHIP_HUE } from './select-color';

/** How a group's key reads as text: an option's name, a date's day or month, a text, a person. */
export function useGroupLabel(
  property: DatabaseProperty,
  granularity?: DateGroupGranularity,
): (key: string | null) => string {
  const { t, locale } = useTranslation();
  return React.useCallback(
    (key: string | null) => {
      if (property.type === 'checkbox') {
        return t(key === 'true' ? 'databases.board.checked' : 'databases.board.unchecked');
      }
      if (key === null) return t('databases.groups.none', { name: property.name });
      switch (property.type) {
        case 'select':
        case 'status':
        case 'multi_select':
          return property.config?.options?.find((o) => o.id === key)?.name ?? key;
        case 'date':
        case 'created_time':
        case 'last_edited_time':
          return dateGroupLabel(key, granularity, locale, (date) =>
            t('databases.groups.weekOf', { date }),
          );
        default:
          return key;
      }
    },
    [property, granularity, t, locale],
  );
}

/** A group as its header shows it: an option's chip, people's chips, else its label. */
export function GroupBadge({
  property,
  groupKey,
  label,
}: {
  property: DatabaseProperty;
  groupKey: string | null;
  label: string;
}) {
  const option =
    groupKey === null ? undefined : property.config?.options?.find((o) => o.id === groupKey);
  if (option) {
    return (
      <Chip size="xs" hue={SELECT_CHIP_HUE[option.color] ?? 'neutral'}>
        {option.name}
      </Chip>
    );
  }
  if (
    groupKey !== null &&
    (property.type === 'person' ||
      property.type === 'created_by' ||
      property.type === 'last_edited_by')
  ) {
    return <PersonChips userIds={[groupKey]} />;
  }
  return <Text className="text-sm font-medium text-foreground">{label}</Text>;
}

interface GroupHeaderProps {
  property: DatabaseProperty;
  groupKey: string | null;
  granularity?: DateGroupGranularity;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
}

/** A group's header in a table or a list: collapses it, names it and counts its rows. */
export function GroupHeader({
  property,
  groupKey,
  granularity,
  count,
  collapsed,
  onToggle,
}: GroupHeaderProps) {
  const { t } = useTranslation();
  const { colors } = useColorScheme();
  const label = useGroupLabel(property, granularity)(groupKey);
  const Chevron = collapsed ? RiArrowRightSLine : RiArrowDownSLine;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: !collapsed }}
      accessibilityLabel={t(collapsed ? 'databases.groups.expand' : 'databases.groups.collapse', {
        name: label,
      })}
      onPress={onToggle}
      className="flex-row items-center gap-2 px-3 py-2 hover:bg-muted/40"
    >
      <Chevron width={14} height={14} fill={colors.mutedForeground} />
      <GroupBadge property={property} groupKey={groupKey} label={label} />
      <Text className="text-xs text-muted-foreground">
        {t('databases.groups.count', { count })}
      </Text>
    </Pressable>
  );
}

/** Which groups of a view are collapsed, for as long as it is shown. */
export function useCollapsedGroups(): {
  collapsed: ReadonlySet<string>;
  toggle: (key: string | null) => void;
  isCollapsed: (key: string | null) => boolean;
} {
  const [collapsed, setCollapsed] = React.useState<ReadonlySet<string>>(new Set());
  const id = (key: string | null) => (key === null ? '\u0000none' : `k:${key}`);
  return {
    collapsed,
    toggle: (key) =>
      setCollapsed((prev) => {
        const next = new Set(prev);
        if (next.has(id(key))) next.delete(id(key));
        else next.add(id(key));
        return next;
      }),
    isCollapsed: (key) => collapsed.has(id(key)),
  };
}
