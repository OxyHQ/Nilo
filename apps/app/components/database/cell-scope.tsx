import * as React from 'react';

/**
 * The database the cells below edit: a person cell lists who it can name
 * from it. Set where a database's rows are shown (its views, a row's page),
 * so a view need not hand it to every cell.
 */
export interface DatabaseCellScope {
  databaseId: string;
}

const DatabaseCellScopeContext = React.createContext<DatabaseCellScope | null>(null);

export function DatabaseCellScopeProvider({
  databaseId,
  children,
}: DatabaseCellScope & { children: React.ReactNode }) {
  const scope = React.useMemo(() => ({ databaseId }), [databaseId]);
  return (
    <DatabaseCellScopeContext.Provider value={scope}>{children}</DatabaseCellScopeContext.Provider>
  );
}

export function useDatabaseCellScope(): DatabaseCellScope | null {
  return React.useContext(DatabaseCellScopeContext);
}
