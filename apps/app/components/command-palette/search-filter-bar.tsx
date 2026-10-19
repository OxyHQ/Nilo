import { Chip, ChipRow } from '@oxy.so/bloom/chip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@oxy.so/bloom/dropdown-menu';
import { RiArrowDownSLine } from '@oxy.so/bloom/icons/RiArrowDownSLine';
import { useTranslation } from '@/hooks/useTranslation';
import {
  EDITED_RANGES,
  type EditedRange,
  PRIVATE_TEAMSPACE,
  type SearchFilters,
} from '@/lib/search-filters';

export interface FilterOption {
  id: string;
  name: string;
}

interface SearchFilterBarProps {
  filters: SearchFilters;
  onChange: (filters: SearchFilters) => void;
  /** The workspace's members, to pick a creator from. */
  people: readonly FilterOption[];
  teamspaces: readonly FilterOption[];
}

/**
 * The quick find's filters, as Notion's: a row of chips under the search
 * field. Title only toggles; the others open a menu of what to narrow to,
 * with "Any" to clear.
 */
export function SearchFilterBar({ filters, onChange, people, teamspaces }: SearchFilterBarProps) {
  const { t } = useTranslation();
  const set = (patch: Partial<SearchFilters>) => onChange({ ...filters, ...patch });

  const person = people.find((p) => p.id === filters.createdBy)?.name;
  const teamspace =
    filters.teamspaceId === PRIVATE_TEAMSPACE
      ? t('commandPalette.filters.private')
      : teamspaces.find((ts) => ts.id === filters.teamspaceId)?.name;

  return (
    <ChipRow>
      <Chip
        size="sm"
        role="checkbox"
        selected={filters.titleOnly}
        onPress={() => set({ titleOnly: !filters.titleOnly })}
        accessibilityLabel={t('commandPalette.filters.titleOnly')}
      >
        {t('commandPalette.filters.titleOnly')}
      </Chip>

      <FilterMenu
        label={t('commandPalette.filters.createdBy')}
        value={person ? t('commandPalette.filters.createdByValue', { name: person }) : null}
        anyLabel={t('commandPalette.filters.anyone')}
        options={people}
        onSelect={(id) => set({ createdBy: id })}
      />

      <FilterMenu
        label={t('commandPalette.filters.teamspace')}
        value={teamspace ?? null}
        anyLabel={t('commandPalette.filters.anywhere')}
        options={[
          ...teamspaces,
          { id: PRIVATE_TEAMSPACE, name: t('commandPalette.filters.private') },
        ]}
        onSelect={(id) => set({ teamspaceId: id })}
      />

      <FilterMenu
        label={t('commandPalette.filters.edited')}
        value={filters.edited ? t(`commandPalette.filters.editedRange.${filters.edited}`) : null}
        anyLabel={t('commandPalette.filters.anytime')}
        options={EDITED_RANGES.map((range) => ({
          id: range,
          name: t(`commandPalette.filters.editedRange.${range}`),
        }))}
        onSelect={(id) => set({ edited: (id as EditedRange | null) ?? null })}
      />
    </ChipRow>
  );
}

function FilterMenu({
  label,
  value,
  anyLabel,
  options,
  onSelect,
}: {
  label: string;
  /** What it is narrowed to, shown on the chip; null when it is not. */
  value: string | null;
  anyLabel: string;
  options: readonly FilterOption[];
  onSelect: (id: string | null) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild label={label}>
        <Chip
          size="sm"
          selected={value !== null}
          trailingIcon={RiArrowDownSLine}
          accessibilityLabel={value ? `${label}: ${value}` : label}
        >
          {value ?? label}
        </Chip>
      </DropdownMenuTrigger>
      <DropdownMenuContent label={label}>
        <DropdownMenuItem onPress={() => onSelect(null)}>{anyLabel}</DropdownMenuItem>
        {options.length > 0 ? <DropdownMenuSeparator /> : null}
        {options.map((option) => (
          <DropdownMenuItem key={option.id} onPress={() => onSelect(option.id)}>
            {option.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
