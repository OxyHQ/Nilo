import * as React from 'react';
import { type DimensionValue, Pressable, View } from 'react-native';
import { RiCheckLine } from '@oxy.so/bloom/icons/RiCheckLine';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@oxy.so/bloom/dropdown-menu';
import { toast } from '@oxy.so/bloom/toast';
import { Text } from '@oxy.so/bloom/typography';
import { useTranslation } from '@/hooks/useTranslation';
import { calculationsFor, formatCalculation } from '@/lib/calculations';
import { useUpdateView } from '@/lib/hooks/use-database-views';
import { useColorScheme } from '@/lib/useColorScheme';
import type {
  CalculationFunction,
  Database,
  DatabaseProperty,
  DatabaseView,
} from '@/lib/types/databases';

interface CalculationCellProps {
  database: Database;
  view: DatabaseView;
  property: DatabaseProperty;
  /** The value the API computed over every row of the view; undefined while it is read. */
  value: number | null | undefined;
  width: DimensionValue;
  /** May choose the calculation (the view's editors). */
  editable: boolean;
}

/**
 * A column's footer cell: what its calculation comes to over all the view's
 * rows, and, for whoever may change the view, a menu of the calculations its
 * type takes ("Calculate" while there is none) — Notion's table footer.
 */
export function CalculationCell({
  database,
  view,
  property,
  value,
  width,
  editable,
}: CalculationCellProps) {
  const { t, locale } = useTranslation();
  const { colors } = useColorScheme();
  const updateView = useUpdateView();
  const [open, setOpen] = React.useState(false);
  const fn = view.config?.calculations?.[property.id];
  const label = fn
    ? t(`databases.calculations.functions.${fn}`)
    : t('databases.calculations.calculate');
  const shown =
    fn && value !== undefined
      ? formatCalculation(fn, value, property, locale, {
          days: (count) => t('databases.calculations.days', { count }),
          hours: (count) => t('databases.calculations.hours', { count }),
        })
      : null;

  const choose = (next: CalculationFunction | null) => {
    const calculations = { ...(view.config.calculations ?? {}) };
    if (next) calculations[property.id] = next;
    else delete calculations[property.id];
    updateView.mutate(
      { databaseId: database.id, viewId: view.id, config: { ...view.config, calculations } },
      { onError: () => toast.error(t('databases.views.updateFailed')) },
    );
    setOpen(false);
  };

  const body = (
    <View className="flex-row items-center justify-end gap-1 px-3 py-2" style={{ width }}>
      {fn || editable ? (
        <Text className="text-xs uppercase tracking-wider text-muted-foreground" numberOfLines={1}>
          {label}
        </Text>
      ) : null}
      {shown !== null ? (
        <Text className="text-sm text-foreground" numberOfLines={1}>
          {shown}
        </Text>
      ) : null}
    </View>
  );
  if (!editable) return <View testID={`calculation-${property.id}`}>{body}</View>;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Pressable
          testID={`calculation-${property.id}`}
          accessibilityRole="button"
          accessibilityLabel={t('databases.calculations.pick', { name: property.name })}
          className="hover:bg-muted/40"
        >
          {body}
        </Pressable>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        label={t('databases.calculations.pick', { name: property.name })}
      >
        <DropdownMenuLabel>{property.name}</DropdownMenuLabel>

        <DropdownMenuItem
          leading={
            !fn ? <RiCheckLine width={14} height={14} fill={colors.foreground} /> : undefined
          }
          onPress={() => choose(null)}
        >
          {t('databases.calculations.none')}
        </DropdownMenuItem>
        {calculationsFor(property).map((option) => (
          <DropdownMenuItem
            key={option}
            leading={
              option === fn ? (
                <RiCheckLine width={14} height={14} fill={colors.foreground} />
              ) : undefined
            }
            onPress={() => choose(option)}
          >
            {t(`databases.calculations.functions.${option}`)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
