import type { ButtonAction, DatabasePropertyType } from './types/databases';

/** A link a button may open: the web or an email, as the API accepts. */
export function isButtonLink(url: string): boolean {
  return /^(https?:\/\/|mailto:)/iu.test(url.trim());
}

/** The properties a button can set: those that hold what is written to them. */
export const SETTABLE_TYPES: ReadonlySet<DatabasePropertyType> = new Set([
  'text',
  'number',
  'select',
  'multi_select',
  'status',
  'date',
  'person',
  'files',
  'checkbox',
  'url',
  'email',
  'phone',
  'relation',
]);

/** What running a button needs of the app: opening a link, writing its row, adding a row. */
export interface ButtonEffects {
  openUrl: (url: string) => Promise<unknown>;
  /** The row's own properties set at once. */
  setProperties: (properties: Record<string, unknown>) => Promise<unknown>;
  createRow: (databaseId: string, title: string | undefined) => Promise<unknown>;
}

/**
 * A button's actions, in order: links opened, the row's properties set (the
 * ones in a run of "edit a property" written together, in one change), rows
 * added (to `databaseId` when an action names none). Stops at the first that
 * fails, which it rethrows.
 */
export async function runButtonActions(
  actions: readonly ButtonAction[],
  databaseId: string,
  effects: ButtonEffects,
): Promise<void> {
  let pending: Record<string, unknown> | null = null;
  const flush = async () => {
    if (!pending) return;
    const properties = pending;
    pending = null;
    await effects.setProperties(properties);
  };
  for (const action of actions) {
    if (action.kind === 'set_property') {
      pending = { ...(pending ?? {}), [action.propertyId]: action.value };
      continue;
    }
    await flush();
    if (action.kind === 'open_url') await effects.openUrl(action.url);
    else await effects.createRow(action.databaseId ?? databaseId, action.title || undefined);
  }
  await flush();
}
