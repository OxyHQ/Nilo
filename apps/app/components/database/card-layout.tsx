import { View } from 'react-native';
import { CoverDisplay } from '@/components/page-chrome/cover-display';
import { encodeCoverFile, encodeCoverImage } from '@/components/page-chrome/cover-value';
import type { Database, DatabaseRow, DatabaseView } from '@/lib/types/databases';
import { orderedProperties } from '@/lib/view-properties';

/** Visibility and ordering are explicit view settings, not a preview limit. */
export function cardProperties(database: Database, view: DatabaseView) {
  const hidden = new Set(view.hiddenProperties);
  return orderedProperties(database, view).filter((p) => p.id !== 'name' && !hidden.has(p.id));
}

export function cardWidth(view: DatabaseView): number {
  const widths =
    view.type === 'board'
      ? { small: 240, medium: 280, large: 360 }
      : { small: 200, medium: 240, large: 320 };
  return widths[view.config.cardSize ?? 'medium'];
}

/** Covers and property files use the same authorised image path as a page. */
export function cardCover(row: DatabaseRow, view: DatabaseView, database: Database): string | null {
  const source = view.config.coverSource ?? (view.type === 'board' ? 'none' : 'pageCover');
  if (source === 'pageCover') return row.cover ?? null;
  if (source !== 'property') return null;
  const property = database.schema.properties.find((p) => p.id === view.config.coverPropertyId);
  if (property?.type !== 'files') return null;
  const value = row.properties[property.id];
  if (!value || typeof value !== 'object' || !('files' in value)) return null;
  const first = value.files[0];
  if (first?.fileId) return encodeCoverFile(first.fileId);
  return first?.url ? encodeCoverImage(first.url) : null;
}

export function CardPreview({
  row,
  view,
  database,
}: {
  row: DatabaseRow;
  view: DatabaseView;
  database: Database;
}) {
  const cover = cardCover(row, view, database);
  if (!cover) return null;
  return (
    <View className="overflow-hidden">
      <CoverDisplay
        value={cover}
        pageId={row.id}
        height={view.config.cardSize === 'large' ? 180 : 128}
        fit={view.config.fit}
      />
    </View>
  );
}
