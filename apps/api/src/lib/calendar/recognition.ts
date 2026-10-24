/**
 * Which databases are calendars, and which of their properties hold each
 * field of an event (`docs/calendar.md`).
 *
 * A database is a calendar when one of its own views (not a linked view) is
 * a calendar on a date property: that property is the event's time, so what
 * Nilo's calendar view shows and what a calendar client reads are the same
 * rows. The personal workspace's `calendar` system database is one by
 * construction, its fields at fixed property ids.
 *
 * The other fields are found by id first (the system ids, which a database
 * may use too), then by type and name, in the database's property order: a
 * text property named Location, a url property, a person property, and so
 * on. Renaming a property of an ordinary database can therefore change what a
 * calendar client reads from it; the system calendar reads ids only.
 */
import type { CalendarFields } from '@oxy.so/nilo-contracts';
import type {
  DatabaseProperty,
  DatabasePropertyType,
  DatabaseSchema,
  DatabaseViewType,
  SystemDatabaseKey,
  ViewConfig,
} from '../../db/schema/databases.js';
import { CALENDAR_PROPERTY } from '../databases/system.js';

interface ViewLike {
  type: DatabaseViewType;
  blockId: string | null;
  config: ViewConfig;
  order: number;
}

type FieldRole = Exclude<keyof CalendarFields, 'when'>;

interface RoleRule {
  id: string;
  types: readonly DatabasePropertyType[];
  /** Names (lowercase, trimmed) that mark the property, best first. */
  names: readonly string[];
  /** Any property of the type will do when none is named so. */
  anyOfType: boolean;
}

const ROLE_RULES: Record<FieldRole, RoleRule> = {
  location: {
    id: CALENDAR_PROPERTY.location,
    types: ['text'],
    names: ['location', 'where', 'place', 'venue'],
    anyOfType: false,
  },
  url: {
    id: CALENDAR_PROPERTY.url,
    types: ['url'],
    names: ['meeting link', 'link', 'url', 'meeting', 'video call'],
    anyOfType: true,
  },
  description: {
    id: CALENDAR_PROPERTY.description,
    types: ['text'],
    names: ['description', 'notes', 'details', 'agenda'],
    anyOfType: false,
  },
  attendees: {
    id: CALENDAR_PROPERTY.attendees,
    types: ['person'],
    names: ['attendees', 'guests', 'participants', 'people', 'invitees'],
    anyOfType: true,
  },
  color: {
    id: CALENDAR_PROPERTY.color,
    types: ['select'],
    names: ['color', 'colour', 'calendar', 'category', 'type'],
    anyOfType: false,
  },
  recurrence: {
    id: CALENDAR_PROPERTY.recurrence,
    types: ['text'],
    names: ['repeat', 'recurrence', 'rrule', 'repeats'],
    anyOfType: false,
  },
  uid: {
    id: CALENDAR_PROPERTY.uid,
    types: ['text'],
    names: ['ical uid', 'uid', 'event uid'],
    anyOfType: false,
  },
};

const normalized = (name: string) => name.trim().toLowerCase();

function findRole(
  properties: readonly DatabaseProperty[],
  rule: RoleRule,
  taken: ReadonlySet<string>,
): string | null {
  const free = properties.filter((p) => !taken.has(p.id) && rule.types.includes(p.type));
  const byId = free.find((p) => p.id === rule.id);
  if (byId) return byId.id;
  for (const name of rule.names) {
    const named = free.find((p) => normalized(p.name) === name);
    if (named) return named.id;
  }
  return rule.anyOfType ? (free[0]?.id ?? null) : null;
}

/** The date property a database's calendar shows, or null when it is not a calendar. */
export function calendarDateProperty(
  database: { systemKey: SystemDatabaseKey | null; propertiesSchema: DatabaseSchema },
  views: readonly ViewLike[],
): string | null {
  const isDate = (id: string | undefined) =>
    id !== undefined &&
    database.propertiesSchema.properties.some((p) => p.id === id && p.type === 'date');
  if (database.systemKey === 'calendar' && isDate(CALENDAR_PROPERTY.when)) {
    return CALENDAR_PROPERTY.when;
  }
  const own = views
    .filter((v) => v.blockId === null && v.type === 'calendar')
    .sort((a, b) => a.order - b.order);
  return own.map((v) => v.config.datePropertyId).find(isDate) ?? null;
}

/** The properties holding each field of an event, or null when the database is not a calendar. */
export function recogniseCalendar(
  database: { systemKey: SystemDatabaseKey | null; propertiesSchema: DatabaseSchema },
  views: readonly ViewLike[],
): CalendarFields | null {
  const when = calendarDateProperty(database, views);
  if (!when) return null;
  const properties = database.propertiesSchema.properties;
  const taken = new Set<string>([when, 'name']);
  const fields: CalendarFields = {
    when,
    location: null,
    url: null,
    description: null,
    attendees: null,
    color: null,
    recurrence: null,
    uid: null,
  };
  const roles = Object.keys(ROLE_RULES) as FieldRole[];
  // Fixed ids first, so a property named like another role cannot take one the database designates.
  for (const role of roles) {
    const byId = properties.find(
      (p) => p.id === ROLE_RULES[role].id && ROLE_RULES[role].types.includes(p.type),
    );
    if (byId && !taken.has(byId.id)) {
      fields[role] = byId.id;
      taken.add(byId.id);
    }
  }
  for (const role of roles) {
    if (fields[role] !== null) continue;
    const id = findRole(properties, ROLE_RULES[role], taken);
    if (id) {
      fields[role] = id;
      taken.add(id);
    }
  }
  return fields;
}
