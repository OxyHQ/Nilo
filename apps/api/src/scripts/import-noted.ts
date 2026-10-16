/**
 * Copy Noted's accounts into Nilo: every note of every user, with its labels,
 * folders, reminder, revisions and recording artifacts, into that user's
 * personal workspace (`lib/noted-importer.ts`). A one-shot, run inside the VPC
 * with the API's image:
 *
 *   bun apps/api/dist/scripts/import-noted.js [--dry-run] [--user <oxyUserId>]
 *
 * `DATABASE_URL` is Nilo's; `NOTED_DATABASE_URL` is Noted's, read in a
 * read-only transaction. Prints one JSON report line per account and exits
 * non-zero on any failure. Safe to run again: what is already in Nilo is
 * left alone.
 */
import postgres from 'postgres';
import { closeDb, getDb } from '../db/client.js';
import { log } from '../lib/logger.js';
import type { NotedFolder, NotedLabel, NotedNote, NotedRevision } from '../lib/noted-import.js';
import { importNotedAccount, type NotedSource } from '../lib/noted-importer.js';
import { ensurePersonalNotesHome } from '../middleware/workspace.js';

function sqlSource(sql: postgres.Sql): NotedSource {
  return {
    async users() {
      const rows = await sql<{ id: string }[]>`
        select distinct oxy_user_id as id from notes where deleted_at is null order by 1`;
      return rows.map((row) => row.id);
    },
    async labels(userId) {
      return sql<NotedLabel[]>`
        select id, name, color from labels where oxy_user_id = ${userId} order by name`;
    },
    async folders(userId) {
      return sql<NotedFolder[]>`
        select id, name, parent_id as "parentId" from folders where oxy_user_id = ${userId}`;
    },
    async notes(userId) {
      return sql<NotedNote[]>`
        select id, oxy_user_id as "oxyUserId", kind, title, body, checklist, color, labels,
          folder_id as "folderId", pinned, archived, trashed, attachments,
          reminder_at as "reminderAt", reminder_sent_at as "reminderSentAt",
          sort_order as "sortOrder", created_at as "createdAt"
        from notes
        where oxy_user_id = ${userId} and deleted_at is null
        order by created_at`;
    },
    async revisions(userId, noteIds) {
      if (noteIds.length === 0) return [];
      return sql<NotedRevision[]>`
        select note_id as "noteId", title, body, checklist, created_at as "createdAt"
        from note_revisions
        where oxy_user_id = ${userId} and note_id in ${sql(noteIds)}
        order by created_at`;
    },
    async appData(userId, noteIds) {
      const found = new Map<string, { artifacts: unknown[]; itemOverrides: unknown[] }>();
      if (noteIds.length === 0) return found;
      const entry = (noteId: string) => {
        let value = found.get(noteId);
        if (!value) {
          value = { artifacts: [], itemOverrides: [] };
          found.set(noteId, value);
        }
        return value;
      };
      // Noted's wire shape (`readGeneratedHalf`): only final artifacts are kept.
      const artifacts = await sql`
        select id, note_id, capture_id, profile, intent, transcript_revision,
          artifact_revision, doc, created_at, updated_at
        from note_artifacts
        where oxy_user_id = ${userId} and note_id in ${sql(noteIds)}`;
      for (const row of artifacts) {
        const doc = (row.doc ?? {}) as Record<string, unknown>;
        entry(row.note_id).artifacts.push({
          id: row.id,
          noteId: row.note_id,
          captureId: row.capture_id,
          stage: 'final',
          profile: row.profile,
          intent: row.intent,
          transcriptRevision: row.transcript_revision,
          artifactRevision: row.artifact_revision,
          title: doc.title,
          sections: doc.sections ?? [],
          people: doc.people,
          checklists: doc.checklists ?? [],
          openQuestions: doc.openQuestions ?? [],
          pendingExpansions: doc.pendingExpansions,
          createdAt: new Date(row.created_at).toISOString(),
          updatedAt: new Date(row.updated_at).toISOString(),
        });
      }
      const overrides = await sql`
        select note_id, item_id, text, checked, removed, adopted
        from note_item_overrides
        where oxy_user_id = ${userId} and note_id in ${sql(noteIds)}`;
      for (const row of overrides) {
        entry(row.note_id).itemOverrides.push({
          itemId: row.item_id,
          text: row.text,
          checked: row.checked,
          removed: row.removed,
          adopted: row.adopted,
        });
      }
      return found;
    },
  };
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main(): Promise<void> {
  const notedUrl = process.env.NOTED_DATABASE_URL;
  if (!notedUrl) throw new Error('NOTED_DATABASE_URL is required.');
  const dryRun = process.argv.includes('--dry-run');
  const only = argument('--user');

  const noted = postgres(notedUrl, { max: 1 });
  try {
    // Noted is only read: the whole copy runs in one read-only transaction,
    // so it also sees one consistent state of every account.
    await noted.begin('read only', async (tx) => {
      const source = sqlSource(tx as unknown as postgres.Sql);
      const users = only ? [only] : await source.users();
      for (const userId of users) {
        const home = await ensurePersonalNotesHome(userId);
        const report = await importNotedAccount(getDb(), source, home, { dryRun });
        console.log(JSON.stringify({ dryRun, ...report }));
      }
    });
  } finally {
    await noted.end({ timeout: 5 });
    await closeDb();
  }
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    log.general.error({ err }, 'Noted import failed');
    process.exit(1);
  },
);
