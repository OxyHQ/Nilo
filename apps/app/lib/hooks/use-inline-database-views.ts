import { useEffect, useRef, useState } from 'react';
import type { Database, DatabaseView } from '../types/databases';
import { useCreateView, useDatabaseViews } from './use-database-views';

/** A hosted database uses its own views; a reference owns views on its block. */
export function useInlineDatabaseViews({
  database,
  ownViews,
  pageId,
  blockId,
  readOnly,
  saved,
  defaultName,
}: {
  database?: Database;
  ownViews: DatabaseView[];
  pageId: string;
  blockId: string;
  readOnly: boolean;
  saved: boolean;
  defaultName: string;
}) {
  const linked = Boolean(database && database.parentPageId !== pageId);
  const query = useDatabaseViews(linked ? database?.id : undefined, blockId, saved);
  const create = useCreateView();
  const attempted = useRef<string | null>(null);
  // A retry is a new attempt, even when the views read again are the same.
  const [attempt, setAttempt] = useState(0);
  const mutate = create.mutate;
  const key = `${database?.id}:${blockId}:${attempt}`;
  useEffect(() => {
    if (
      !linked ||
      !database ||
      readOnly ||
      !saved ||
      !query.isSuccess ||
      query.data.views.length ||
      attempted.current === key
    )
      return;
    attempted.current = key;
    mutate({ databaseId: database.id, blockId, name: defaultName, type: 'table' });
  }, [
    linked,
    database,
    readOnly,
    saved,
    query.isSuccess,
    query.data,
    key,
    mutate,
    blockId,
    defaultName,
  ]);
  return {
    linked,
    views: linked ? (query.data?.views ?? []) : ownViews,
    isLoading: linked && (query.isLoading || create.isPending || (!saved && !query.data)),
    error: linked ? (query.error ?? create.error) : null,
    retry: () => {
      setAttempt((n) => n + 1);
      create.reset();
      void query.refetch();
    },
  };
}
