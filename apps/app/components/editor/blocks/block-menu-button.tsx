import * as React from 'react';
import { Pressable } from 'react-native';
import type { BloomIconComponent } from '@oxy.so/bloom/icons';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@oxy.so/bloom/dropdown-menu';
import { RiMoreLine } from '@oxy.so/bloom/icons/RiMoreLine';
import { useColorScheme } from '@/lib/useColorScheme';
import { cn } from '@/lib/utils';

/** One entry of a block's own menu (a table's row, a column of a layout). */
export type BlockMenuEntry =
  | {
      kind?: 'item';
      label: string;
      onPress: () => void;
      destructive?: boolean;
      disabled?: boolean;
    }
  | { kind: 'check'; label: string; checked: boolean; onChange: (checked: boolean) => void }
  | { kind: 'separator' };

/**
 * The small "⋯" button that opens a block's own options: a table's rows and
 * columns, a layout's columns, an image's size. Pressed, not hovered, so it
 * works the same with a finger.
 */
export function BlockMenuButton({
  label,
  entries,
  icon: Icon = RiMoreLine,
  className,
  size = 16,
}: {
  label: string;
  entries: readonly BlockMenuEntry[];
  icon?: BloomIconComponent;
  className?: string;
  size?: number;
}) {
  const { colors } = useColorScheme();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          hitSlop={6}
          className={cn(
            'items-center justify-center rounded hover:bg-muted active:bg-muted',
            className,
          )}
          style={{ minWidth: size + 4, minHeight: size + 4 }}
        >
          <Icon width={size} height={size} fill={colors.mutedForeground} />
        </Pressable>
      </DropdownMenuTrigger>
      <DropdownMenuContent label={label}>
        {entries.map((entry, index) => {
          const key = `${index}-${entry.kind === 'separator' ? 'separator' : entry.label}`;
          if (entry.kind === 'separator')
            return (
              <React.Fragment key={key}>
                <DropdownMenuSeparator />
              </React.Fragment>
            );
          if (entry.kind === 'check') {
            return (
              <DropdownMenuCheckboxItem
                key={key}
                checked={entry.checked}
                onCheckedChange={entry.onChange}
              >
                {entry.label}
              </DropdownMenuCheckboxItem>
            );
          }
          return (
            <DropdownMenuItem
              key={key}
              onPress={entry.onPress}
              disabled={entry.disabled}
              variant={entry.destructive ? 'destructive' : 'default'}
            >
              {entry.label}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
