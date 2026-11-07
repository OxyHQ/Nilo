/**
 * Database automations: when something happens to a database's rows, do
 * something. One shape for the API's validation, the executor and the app's
 * editor, so they cannot drift.
 */
import { z } from 'zod';

/** What starts an automation. */
export const AUTOMATION_TRIGGER_KINDS = ['row_added', 'property_edited'] as const;
export type AutomationTriggerKind = (typeof AUTOMATION_TRIGGER_KINDS)[number];

export type AutomationTrigger =
  /** A row was added to the database (never a template). */
  | { kind: 'row_added' }
  /**
   * A property of a row was edited, to anything or, with `equals`, to exactly
   * that stored value (`{ optionId }` for a status, `{ checked: true }`…).
   */
  | { kind: 'property_edited'; propertyId: string; equals?: unknown };

/** What an automation does, in order. */
export const AUTOMATION_ACTION_KINDS = ['set_property', 'notify', 'webhook', 'create_row'] as const;
export type AutomationActionKind = (typeof AUTOMATION_ACTION_KINDS)[number];

/** Who a `notify` action tells. */
export type AutomationRecipients =
  /** The people a person property of the row names. */
  | { kind: 'property'; propertyId: string }
  /** These people. */
  | { kind: 'people'; userIds: string[] };

export type AutomationAction =
  /** Set one of the row's own properties to `value` (the shape its type stores). */
  | { kind: 'set_property'; propertyId: string; value: unknown }
  /** Send a notification about the row. */
  | { kind: 'notify'; to: AutomationRecipients; message?: string }
  /** POST the row's event to a public https address, signed with the automation's secret. */
  | { kind: 'webhook'; url: string }
  /** Add a row to a database (this one when `databaseId` is absent), titled `title`. */
  | { kind: 'create_row'; databaseId?: string; title?: string };

export const MAX_AUTOMATION_ACTIONS = 5;
/** The most automations one database has. */
export const MAX_AUTOMATIONS_PER_DATABASE = 25;
/**
 * How deep automations may trigger one another (an automation that sets a
 * property another watches, and so on). Past it the chain stops, so two
 * automations that undo each other cannot run forever.
 */
export const MAX_AUTOMATION_DEPTH = 3;

const propertyId = z.string().min(1).max(200);
const entityId = z.string().min(1).max(200);

export const automationTriggerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('row_added') }).strict(),
  z
    .object({
      kind: z.literal('property_edited'),
      propertyId,
      equals: z.unknown().optional(),
    })
    .strict(),
]);

const recipientsSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('property'), propertyId }).strict(),
  z.object({ kind: z.literal('people'), userIds: z.array(entityId).min(1).max(50) }).strict(),
]);

export const automationActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('set_property'), propertyId, value: z.unknown() }).strict(),
  z
    .object({
      kind: z.literal('notify'),
      to: recipientsSchema,
      message: z.string().trim().max(500).optional(),
    })
    .strict(),
  z.object({ kind: z.literal('webhook'), url: z.url({ protocol: /^https$/ }).max(2000) }).strict(),
  z
    .object({
      kind: z.literal('create_row'),
      databaseId: entityId.optional(),
      title: z.string().max(2000).optional(),
    })
    .strict(),
]);

export const automationInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    enabled: z.boolean().optional(),
    trigger: automationTriggerSchema,
    actions: z.array(automationActionSchema).min(1).max(MAX_AUTOMATION_ACTIONS),
  })
  .strict();
export type AutomationInput = z.infer<typeof automationInputSchema>;

export const automationPatchSchema = automationInputSchema.partial();
export type AutomationPatch = z.infer<typeof automationPatchSchema>;

/** An automation as the API serves it. */
export interface Automation {
  id: string;
  databaseId: string;
  name: string;
  enabled: boolean;
  trigger: AutomationTrigger;
  actions: AutomationAction[];
  createdBy: string;
  lastRunAt: string | null;
  /** How the last run went; null before the first. */
  lastStatus: 'ok' | 'failed' | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Whether an edit of `propertyId` to `after` (from `before`) starts `trigger`. */
export function triggerFires(
  trigger: AutomationTrigger,
  event: { created: boolean; before: Record<string, unknown>; after: Record<string, unknown> },
): boolean {
  if (trigger.kind === 'row_added') return event.created;
  if (event.created) return false;
  const was = JSON.stringify(event.before[trigger.propertyId] ?? null);
  const is = JSON.stringify(event.after[trigger.propertyId] ?? null);
  if (was === is) return false;
  return trigger.equals === undefined || JSON.stringify(trigger.equals) === is;
}
