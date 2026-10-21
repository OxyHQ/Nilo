export const queryKeys = {
  breadcrumbNeighbors: {
    all: ['breadcrumb-neighbors'] as const,
    workspace: (workspaceId: string) => ['breadcrumb-neighbors', workspaceId] as const,
    anchor: (workspaceId: string, kind: 'page' | 'database', id: string) =>
      ['breadcrumb-neighbors', workspaceId, kind, id] as const,
  },
  forms: {
    all: ['forms'] as const,
    link: (id: string, viewId: string) => ['form-link', id, viewId] as const,
    public: (token: string, userId?: string) => ['forms', token, userId] as const,
  },
  publicPages: {
    all: ['public-pages'] as const,
    detail: (slug: string, pageId?: string) => ['public-pages', slug, pageId] as const,
  },
  pageActivity: {
    all: ['page-activity'] as const,
    workspace: (workspaceId: string) => ['page-activity', workspaceId] as const,
    page: (workspaceId: string, pageId: string) => ['page-activity', workspaceId, pageId] as const,
  },
  versions: {
    list: (id: string) => ['versions', id] as const,
    detail: (id: string, versionId: string) => ['version', id, versionId] as const,
  },
  reminders: {
    all: ['reminders'] as const,
    list: (userId?: string, pageId?: string) => ['reminders', userId, pageId] as const,
  },
  recentPages: {
    all: ['recent-pages'] as const,
    workspace: (workspaceId: string | null) => ['recent-pages', workspaceId] as const,
  },
  search: {
    all: ['search'] as const,
    workspace: (workspaceId: string | null) => ['search', workspaceId] as const,
    results: (workspaceId: string | null, query: string) => ['search', workspaceId, query] as const,
  },
  pages: {
    follow: (id: string) => ['page', id, 'follow'] as const,
    backlinks: (id: string) => ['page', id, 'backlinks'] as const,
    templates: (workspaceId: string | null) => ['pages', workspaceId, 'templates'] as const,
    shared: ['shared-pages'] as const,
    permissions: (id: string) => ['page-permissions', id] as const,
    list: (workspaceId: string | null) => ['pages', workspaceId] as const,
    detail: (id: string) => ['page', id] as const,
    breadcrumb: (id: string, workspaceId: string | null | undefined) =>
      ['page', id, 'breadcrumb', workspaceId] as const,
    archived: (workspaceId: string | null) => ['pages', workspaceId, 'archived'] as const,
  },
  blocks: {
    list: (pageId: string) => ['blocks', pageId] as const,
  },
  // Never persisted offline (`lib/offline-cache.ts`): a file URL is a credential that expires.
  files: {
    url: (scope: string, fileId: string) => ['file-url', scope, fileId] as const,
    cachedImage: (fileId: string) => ['file-cached-image', fileId] as const,
  },
  syncedBlocks: {
    usages: (blockId: string) => ['synced-blocks', 'usages', blockId] as const,
    list: (workspaceId: string) => ['synced-blocks', 'list', workspaceId] as const,
  },
  comments: {
    page: (pageId: string, includeResolved: boolean) =>
      ['comments', 'page', pageId, includeResolved] as const,
    block: (blockId: string) => ['comments', 'block', blockId] as const,
  },
  databases: {
    templates: (id: string) => ['database', id, 'templates'] as const,
    list: (workspaceId: string | null) => ['databases', workspaceId] as const,
    detail: (id: string) => ['database', id] as const,
    views: (id: string) => ['database', id, 'views'] as const,
    blockViews: (id: string, blockId: string) => ['database', id, 'views', blockId] as const,
    rows: (id: string, viewId: string | null) => ['database', id, 'rows', viewId] as const,
    /** One row with its computed values (`rows` holds lists only). */
    row: (id: string, rowId: string) => ['database', id, 'row', rowId] as const,
    /** The rows a relation points at, read together. */
    related: (id: string, rowIds: readonly string[]) =>
      ['database', id, 'related', ...rowIds] as const,
    /** Every row a view's relations point at in one database, with the ids read. */
    relatedSet: (id: string, rowIds: readonly string[]) =>
      ['database', id, 'related-set', ...rowIds] as const,
    /** Rows found by title, for a relation's picker (`rows` holds a view's lists only). */
    search: (id: string, query: string) => ['database', id, 'search', query] as const,
    /** Who a person property can name. */
    people: (id: string) => ['database', id, 'people'] as const,
  },
} as const;
