import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { RiCheckLine } from '@oxy.so/bloom/icons/RiCheckLine';
import { RiCloseLine } from '@oxy.so/bloom/icons/RiCloseLine';
import { Avatar } from '@oxy.so/bloom/avatar';
import { Button } from '@oxy.so/bloom/button';
import { Chip } from '@oxy.so/bloom/chip';
import { EmptyState } from '@oxy.so/bloom/empty-state';
import { Item } from '@oxy.so/bloom/item';
import { Popover, PopoverContent, PopoverTrigger } from '@oxy.so/bloom/popover';
import { TextFieldInput } from '@oxy.so/bloom/text-field';
import { Text } from '@oxy.so/bloom/typography';
import { useTranslation } from '@/hooks/useTranslation';
import { useColorScheme } from '@/lib/useColorScheme';
import { profileName, useMemberProfiles } from '@/lib/hooks/use-member-profiles';
import { memberProfileName } from '@/lib/hooks/use-workspace-members';
import { useDatabasePeople } from '@/lib/hooks/use-database-people';
import { useDatabaseCellScope } from './cell-scope';

/**
 * People by their names and avatars, read from Oxy in one batch for the cell;
 * with `onRemove`, each can be taken out.
 */
export function PersonChips({
  userIds,
  onRemove,
}: {
  userIds: string[];
  onRemove?: (userId: string) => void;
}) {
  const { t } = useTranslation();
  const { data: profiles, isError } = useMemberProfiles(userIds);
  if (userIds.length === 0) return <Text className="text-sm text-muted-foreground">—</Text>;
  const byId = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
  return (
    <View className="flex-row flex-wrap gap-1">
      {userIds.map((id) => {
        const profile = byId.get(id);
        // Asked, and not there: someone Oxy no longer answers for.
        const name =
          profileName(profile) ??
          t(profiles || isError ? 'databases.people.unknown' : 'common.loading');
        return (
          <Chip
            key={id}
            size="sm"
            accessibilityLabel={name}
            leading={<Avatar source={profile?.avatar ?? null} name={name} size="xs" />}
            {...(onRemove && {
              onClose: () => onRemove(id),
              closeLabel: t('databases.people.remove', { name }),
            })}
          >
            {name}
          </Chip>
        );
      })}
    </View>
  );
}

interface PersonCellProps {
  value: string[];
  label: string;
  variant: 'table' | 'panel' | 'card';
  onChange: (userIds: string[]) => void;
}

/**
 * A person property: its people, and a picker of everyone the database can
 * name (its workspace's members and guests) to add or remove one.
 */
export function PersonCell({ value, label, variant, onChange }: PersonCellProps) {
  const [open, setOpen] = React.useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          className={variant === 'table' ? 'py-0.5' : 'py-1'}
        >
          <PersonChips userIds={value} />
        </Pressable>
      </PopoverTrigger>
      <PopoverContent align="start" minWidth={280} label={label} className="gap-2">
        {open ? <PersonPicker value={value} onChange={onChange} /> : null}
      </PopoverContent>
    </Popover>
  );
}

function PersonPicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (userIds: string[]) => void;
}) {
  const { t } = useTranslation();
  const { colors } = useColorScheme();
  const scope = useDatabaseCellScope();
  const [query, setQuery] = React.useState('');
  const { data: people, isPending, isError } = useDatabasePeople(scope?.databaseId);

  const needle = query.trim().toLowerCase();
  const shown = (people ?? []).filter((person) => {
    if (!needle) return true;
    const user = person.user;
    return [memberProfileName(person), user?.username, user?.email].some((text) =>
      text?.toLowerCase().includes(needle),
    );
  });
  const toggle = (userId: string) =>
    onChange(value.includes(userId) ? value.filter((id) => id !== userId) : [...value, userId]);

  return (
    <>
      {value.length > 0 ? <PersonChips userIds={value} onRemove={toggle} /> : null}
      <TextFieldInput
        size="sm"
        label={t('databases.people.search')}
        value={query}
        onChangeText={setQuery}
      />
      <ScrollView style={{ maxHeight: 280 }} keyboardShouldPersistTaps="handled">
        {isPending && scope ? (
          <Text className="py-2 text-sm text-muted-foreground">{t('common.loading')}</Text>
        ) : shown.length === 0 ? (
          <EmptyState
            variant="compact"
            title={t(isError || !scope ? 'databases.people.failed' : 'databases.people.none')}
          />
        ) : (
          shown.map((person) => {
            const name = memberProfileName(person) ?? t('databases.people.unknown');
            const selected = value.includes(person.userId);
            return (
              <Item
                key={person.userId}
                density="compact"
                role="checkbox"
                selected={selected}
                accessibilityLabel={name}
                leading={<Avatar source={person.user?.avatar ?? null} name={name} size="sm" />}
                title={name}
                subtitle={person.guest ? t('databases.people.guest') : undefined}
                trailing={
                  selected ? <RiCheckLine width={14} height={14} fill={colors.foreground} /> : null
                }
                onPress={() => toggle(person.userId)}
              />
            );
          })
        )}
      </ScrollView>
      {value.length > 0 ? (
        <Button
          appearance="plain"
          size="sm"
          className="self-start"
          stopPropagation
          onPress={() => onChange([])}
          leadingIcon={RiCloseLine}
        >
          {t('databases.actions.clearAll')}
        </Button>
      ) : null}
    </>
  );
}
