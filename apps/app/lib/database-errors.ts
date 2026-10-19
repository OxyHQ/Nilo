import axios from 'axios';
import i18n from '@/lib/i18n';
import type { Database, SystemDatabaseKey } from '@/lib/types/databases';

/** The app that keeps each system database: product names, not translated. */
const SYSTEM_APPS: Record<SystemDatabaseKey, string> = {
  notes: 'Noted',
  note_folders: 'Noted',
};

/**
 * What to tell someone a change to a database or its properties was refused
 * for. An app's database (`systemKey`) keeps the properties the app reads and
 * cannot be deleted, and the API says so with a 409 SYSTEM_PROPERTY or
 * SYSTEM_DATABASE; anything else is `fallback`. Translated at call time: the
 * locale can change while the app runs.
 */
export function databaseChangeError(
  error: unknown,
  database: Pick<Database, 'systemKey'>,
  fallback: string,
): string {
  const code = axios.isAxiosError(error)
    ? (error.response?.data as { code?: unknown } | undefined)?.code
    : undefined;
  if (!database.systemKey) return fallback;
  const app = SYSTEM_APPS[database.systemKey];
  if (code === 'SYSTEM_PROPERTY') return i18n.t('databases.system.property', { app });
  if (code === 'SYSTEM_DATABASE') return i18n.t('databases.system.database', { app });
  return fallback;
}
