import * as React from 'react';
import { Pressable, View } from 'react-native';
import { RiCloseLine } from '@oxy.so/bloom/icons/RiCloseLine';
import { Button } from '@oxy.so/bloom/button';
import { Calendar, RangeCalendar, TimeField } from '@oxy.so/bloom/date-picker';
import { Popover, PopoverContent, PopoverTrigger } from '@oxy.so/bloom/popover';
import { Switch } from '@oxy.so/bloom/switch';
import { Text } from '@oxy.so/bloom/typography';
import { useTranslation } from '@/hooks/useTranslation';
import {
  type DateParts,
  dayOf,
  formatDateValue,
  readDateValue,
  timeOf,
  withDays,
  withEnd,
  withTime,
  withTimeOf,
} from '@/lib/date-values';
import type { PropertyValue } from '@/lib/types/databases';

interface DateCellProps {
  value: PropertyValue;
  label: string;
  variant: 'table' | 'panel' | 'card';
  onChange: (next: DateParts) => void;
}

/**
 * A date property: its day (or days) and time, and a popover to pick them:
 * a calendar, or a range of days with an end date, and the time of each with
 * "Include time". Bloom's own calendar and time field, on web and native.
 * Each change is written at once; editing one part keeps the others.
 */
export function DateCell({ value, label, variant, onChange }: DateCellProps) {
  const { t, locale } = useTranslation();
  const [open, setOpen] = React.useState(false);
  const display = formatDateValue(value, locale);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={display ? `${label}: ${display}` : label}
          className={variant === 'table' ? 'py-0.5' : 'py-1'}
        >
          <Text className={display ? 'text-sm text-foreground' : 'text-sm text-muted-foreground'}>
            {display || '—'}
          </Text>
        </Pressable>
      </PopoverTrigger>
      <PopoverContent align="start" label={label} className="gap-3">
        {open ? (
          <DateEditor
            value={value}
            onChange={onChange}
            onClear={() => {
              onChange({ start: null, end: null, includeTime: false });
              setOpen(false);
            }}
            clearLabel={t('databases.actions.clear')}
          />
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

interface DateEditorProps {
  value: PropertyValue;
  onChange: (next: DateParts) => void;
  onClear: () => void;
  clearLabel: string;
}

/** The popover's body; its value is the cell's, so what it shows is what was last written. */
export function DateEditor({ value, onChange, onClear, clearLabel }: DateEditorProps) {
  const { t, locale } = useTranslation();
  const parts = readDateValue(value);
  const startDay = parts.start ? dayOf(parts.start, parts.includeTime) : null;
  const endDay = parts.end ? dayOf(parts.end, parts.includeTime) : null;
  // A toggled end with no day yet: the range calendar opens on it.
  const [hasEnd, setHasEnd] = React.useState(parts.end !== null);

  return (
    <>
      {hasEnd ? (
        <RangeCalendar
          locale={locale}
          accessibilityLabel={t('databases.dates.range')}
          value={startDay ? { start: startDay, end: endDay ?? startDay } : null}
          onChange={(range) => onChange(withDays(value, range.start, range.end))}
        />
      ) : (
        <Calendar
          locale={locale}
          accessibilityLabel={t('databases.dates.date')}
          value={startDay}
          onChange={(day) => onChange(withDays(value, day, null))}
        />
      )}
      {parts.includeTime && parts.start ? (
        <View className="flex-row items-center gap-2">
          <TimeField
            size="sm"
            accessibilityLabel={t('databases.dates.startTime')}
            value={timeOf(parts.start)}
            onChange={(time) => {
              if (time) onChange(withTimeOf(value, 'start', time));
            }}
          />
          {parts.end ? (
            <>
              <Text className="text-sm text-muted-foreground">→</Text>
              <TimeField
                size="sm"
                accessibilityLabel={t('databases.dates.endTime')}
                value={timeOf(parts.end)}
                onChange={(time) => {
                  if (time) onChange(withTimeOf(value, 'end', time));
                }}
              />
            </>
          ) : null}
        </View>
      ) : null}
      <ToggleRow
        label={t('databases.dates.endDate')}
        checked={hasEnd}
        onCheckedChange={(on) => {
          setHasEnd(on);
          if (parts.start) onChange(withEnd(value, on));
        }}
      />
      <ToggleRow
        label={t('databases.dates.includeTime')}
        checked={parts.includeTime}
        disabled={!parts.start}
        onCheckedChange={(on) => onChange(withTime(value, on))}
      />
      {parts.start ? (
        <Button
          appearance="plain"
          size="sm"
          className="self-start"
          stopPropagation
          onPress={onClear}
          leadingIcon={RiCloseLine}
        >
          {clearLabel}
        </Button>
      ) : null}
    </>
  );
}

function ToggleRow({
  label,
  checked,
  disabled,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <View className="flex-row items-center justify-between gap-3">
      <Text className="text-sm text-foreground">{label}</Text>
      <Switch
        size="sm"
        accessibilityLabel={label}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
      />
    </View>
  );
}
