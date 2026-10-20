import { MAX_COLUMN_WIDTH, MIN_COLUMN_WIDTH } from '@oxy.so/nilo-contracts';
import { place, rankBy } from './list-order';
import type { Database, DatabaseProperty, DatabaseView } from './types/databases';

/** A table's columns before they are resized: the title wider than the others. */
export const DEFAULT_COLUMN_WIDTH = 200;
export const DEFAULT_TITLE_WIDTH = 280;

/**
 * A view's properties in its own order (`config.propertyOrder`), as Notion
 * keeps an order per view: those it names first, in that order, then the
 * others — a property added since — in the database's.
 */
export function orderedProperties(
  database: Pick<Database, 'schema'>,
  view: Pick<DatabaseView, 'config'>,
): DatabaseProperty[] {
  const order = view.config?.propertyOrder;
  const properties = database.schema.properties;
  if (!order || order.length === 0) return properties;
  return rankBy(properties, order, (property) => property.id);
}

/**
 * The view's order with `id` moved `by` places among `among` (the ids the
 * reader sees, in order), the rest kept where they were: what "Move left" or
 * dragging a column writes to `config.propertyOrder`. Null when it cannot
 * move that way.
 */
export function moveProperty(
  ordered: readonly string[],
  among: readonly string[],
  id: string,
  by: number,
): string[] | null {
  const from = among.indexOf(id);
  const to = from + by;
  if (from === -1 || to < 0 || to >= among.length || by === 0) return null;
  return place(ordered, id, among[to] as string, by > 0 ? 'after' : 'before');
}

/** A column's width in a view: as resized, clamped, or the default. */
export function columnWidth(view: Pick<DatabaseView, 'config'>, propertyId: string): number {
  const fallback = propertyId === 'name' ? DEFAULT_TITLE_WIDTH : DEFAULT_COLUMN_WIDTH;
  const stored = view.config?.columnWidths?.[propertyId];
  return typeof stored === 'number' ? clampWidth(stored) : fallback;
}

export function clampWidth(width: number): number {
  return Math.round(Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, width)));
}
