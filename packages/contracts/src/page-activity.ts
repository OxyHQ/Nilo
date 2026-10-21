import type { DatabasePropertyType, DateFormat } from './databases';

/** Persisted changes to one page, distinct from restorable content snapshots. */
export type PageActivityKind =
  | 'created'
  | 'metadata_changed'
  | 'properties_changed'
  | 'content_edited';

/** Historical display schema only; never relation targets, formulas or actions. */
export interface PageActivityProperty {
  name: string;
  type: DatabasePropertyType;
  config?: {
    options?: {
      id: string;
      name: string;
      color:
        | 'default'
        | 'gray'
        | 'brown'
        | 'orange'
        | 'yellow'
        | 'green'
        | 'blue'
        | 'purple'
        | 'pink'
        | 'red';
    }[];
    format?:
      | 'number'
      | 'number_with_commas'
      | 'percent'
      | 'currency:USD'
      | 'currency:EUR'
      | 'currency:GBP'
      | 'currency:JPY';
    precision?: number;
    dateFormat?: DateFormat;
    includeTime?: boolean;
    prefix?: string;
  };
}

export interface PageActivityChange {
  /** Page metadata key, or `properties` with a propertyId. */
  field: string;
  propertyId?: string;
  /** Captured at write time; omitted unless caller can also read the database. */
  property?: PageActivityProperty;
  before: unknown;
  after: unknown;
}

export interface PageActivityEvent {
  id: string;
  pageId: string;
  /** Actual actors; empty for unattributed/system changes, never guessed. */
  actorIds: string[];
  kind: PageActivityKind;
  createdAt: string;
  /** Content events deliberately contain no fabricated text diff. */
  changes: PageActivityChange[];
}

export interface PageActivityPage {
  items: PageActivityEvent[];
  nextCursor: string | null;
}
