import { View } from 'react-native';
import { IconDisplay } from './icon-display';
import { getLucideIcon } from './lucide-icons';

/**
 * A callout's icon, encoded like a page icon (`emoji:…`, `icon:…`,
 * `image:…`). Callouts saved before that encoding hold a bare emoji or a bare
 * icon name; both still show.
 */
export function CalloutIcon({ value, size = 18 }: { value: unknown; size?: number }) {
  const raw = typeof value === 'string' ? value.trim() : '';
  const encoded =
    raw && !raw.includes(':') && getLucideIcon(raw) ? `icon:${raw}` : raw || 'icon:lightbulb';
  return (
    <View
      className="items-center justify-center"
      style={{ minWidth: size + 6, height: size * 1.55 }}
    >
      <IconDisplay value={encoded} size={size} />
    </View>
  );
}
