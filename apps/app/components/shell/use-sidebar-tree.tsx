import * as React from 'react';
import { usePathname, useRouter } from 'expo-router';
import { Button } from '@oxy.so/bloom/button';
import { useDialogControl } from '@oxy.so/bloom/dialog';
import { RiAddLine } from '@oxy.so/bloom/icons/RiAddLine';
import { RiCompass3Line } from '@oxy.so/bloom/icons/RiCompass3Line';
import { RiSettings3Line } from '@oxy.so/bloom/icons/RiSettings3Line';
import type { SidebarTree, SidebarTreeDrop, SidebarTreeItem } from '@oxy.so/bloom/sidebar';
import { toast } from '@oxy.so/bloom/toast';
import { useOxy } from '@oxy.so/services/ui/client';
import { IconDisplay } from '@/components/page-chrome/icon-display';
import { TeamspaceDialog, type TeamspaceSelection } from '@/components/teamspaces/teamspace-dialog';
import { WorkspaceAvatar } from '@/components/workspace/workspace-avatar';
import { useTranslation } from '@/hooks/useTranslation';
import { apiErrorMessage } from '@/lib/api/error-message';
import { useDatabases } from '@/lib/hooks/use-databases';
import { useSharedPages } from '@/lib/hooks/use-page-permissions';
import { useDuplicatePage, usePages, useTemplates, useUpdatePage } from '@/lib/hooks/use-pages';
import { useRecentPageIds } from '@/lib/hooks/use-recent-pages';
import { canAddToTeamspace, useTeamspaces } from '@/lib/hooks/use-teamspaces';
import { useWorkspaceRole } from '@/lib/hooks/use-workspaces';
import { hasRole } from '@/lib/hooks/workspace-roles';
import { groupSidebar } from '@/lib/sidebar-groups';
import { type PageMove, planSectionDrop, planSidebarDrop } from '@/lib/sidebar-drop';
import { useNewPageStore } from '@/lib/stores/new-page-store';
import { type SidebarSectionKey, useUIStore } from '@/lib/stores/ui-store';
import type { Page } from '@/lib/types/pages';
import { PageRowActions } from './page-row-actions';
import { databaseRows, pageRows } from './page-rows';

const RECENT_LIMIT = 5;

/** Where a page dropped on a row or a section lands: the tree it joins, and its place. */
interface Destination {
  pages: readonly Page[];
  place: { teamspaceId: string | null };
}

/**
 * The workspace's page tree as Bloom `Sidebar` sections, in Notion's order:
 * shared with me, recent, favorites, teamspaces, private, shared, templates.
 *
 * Pages move between the private section and the teamspaces by drag (or the
 * keyboard and accessibility moves Bloom offers): `onTreeItemDrop` turns a
 * drop into the `PATCH /pages/:id` writes of `planSidebarDrop` /
 * `planSectionDrop`. Only those trees' rows move, so their keys are the page
 * ids; every other listing of a page prefixes its key.
 */
export function useSidebarTree(workspaceId: string | null): {
  tree: SidebarTree[];
  onTreeItemDrop: (drop: SidebarTreeDrop) => void;
  dialogs: React.ReactNode;
} {
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useOxy();
  const pages = usePages(workspaceId);
  const databases = useDatabases(workspaceId);
  const teamspaces = useTeamspaces(workspaceId);
  const role = useWorkspaceRole(workspaceId);
  const recentIds = useRecentPageIds(workspaceId);
  const shared = useSharedPages();
  const templates = useTemplates(workspaceId);
  const duplicate = useDuplicatePage();
  const updatePage = useUpdatePage();
  const openNewPage = useNewPageStore((s) => s.open);
  const sectionCollapsed = useUIStore((s) => s.sectionCollapsed);
  const setSectionCollapsed = useUIStore((s) => s.setSectionCollapsed);
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
  const teamspaceDialog = useDialogControl();
  const [selection, setSelection] = React.useState<TeamspaceSelection>('browse');

  const onExpandedChange = React.useCallback(
    (key: string, open: boolean) => setExpanded((all) => ({ ...all, [key]: open })),
    [],
  );
  const sectionState = React.useCallback(
    (key: SidebarSectionKey) => ({
      collapsible: true,
      open: !sectionCollapsed[key],
      onOpenChange: (open: boolean) => setSectionCollapsed(key, !open),
    }),
    [sectionCollapsed, setSectionCollapsed],
  );

  const allPages = pages.data?.pages;
  const grouped = React.useMemo(
    () =>
      groupSidebar(
        allPages ?? [],
        databases.data?.databases ?? [],
        teamspaces.data ?? [],
        user?.id ?? '',
      ),
    [allPages, databases.data?.databases, teamspaces.data, user?.id],
  );

  // The sections, and where a drop on each of their rows (or labels) lands:
  // drops resolve against what the tree was built from.
  const { tree, routes } = React.useMemo<{
    tree: SidebarTree[];
    routes: ReadonlyMap<string, Destination>;
  }>(() => {
    if (!workspaceId) return { tree: [], routes: new Map() };
    const untitled = t('pages.untitled');
    const emptyLabel = t('sidebar.noPagesInside');
    const canEdit = hasRole(role, 'editor');
    const routes = new Map<string, Destination>();
    const actions = (page: Page) => <PageRowActions page={page} workspaceId={workspaceId} />;
    const rows = (list: readonly Page[], keyPrefix: string, editable: boolean) =>
      pageRows(list, {
        keyPrefix,
        activePath: pathname,
        expanded,
        onExpandedChange,
        draggable: editable && keyPrefix === '',
        untitled,
        emptyLabel,
        actions: editable ? actions : undefined,
      });
    const placed = (list: readonly Page[], place: Destination['place'], key: string) => {
      const destination = { pages: list, place };
      routes.set(key, destination);
      for (const page of list) routes.set(page.id, destination);
    };
    const sections: SidebarTree[] = [];

    // Pages other workspaces share with you, by workspace.
    const sharedGroups = shared.data?.shared.filter((group) => group.pages.length > 0) ?? [];
    if (sharedGroups.length > 0) {
      sections.push({
        key: 'shared-with-me',
        label: t('sidebar.sections.sharedWithMe'),
        droppable: false,
        items: sharedGroups.map(({ workspace, pages: list }) => ({
          key: `shared-ws:${workspace.id}`,
          label: workspace.name,
          leading: <WorkspaceAvatar workspace={workspace} size={16} />,
          items: rows(list, `shared-ws:${workspace.id}:`, false),
          open: expanded[`shared-ws:${workspace.id}`] ?? true,
          onOpenChange: (open) => onExpandedChange(`shared-ws:${workspace.id}`, open),
        })),
      });
    }

    // The last pages opened, from every device.
    const byId = new Map((allPages ?? []).map((page) => [page.id, page]));
    const recent = recentIds
      .map((id) => byId.get(id))
      .filter((page): page is Page => page !== undefined && !page.archived)
      .slice(0, RECENT_LIMIT);
    if (recent.length > 0) {
      sections.push({
        key: 'recent',
        label: t('sidebar.recent'),
        droppable: false,
        items: recent.map((page) => ({
          key: `recent:${page.id}`,
          label: page.title.trim() || untitled,
          leading: <IconDisplay value={page.icon} size={15} showPlaceholder pageId={page.id} />,
          href: `/p/${page.id}`,
          selected: pathname === `/p/${page.id}`,
        })),
      });
    }

    // Each reader's own stars.
    const favorites = (allPages ?? []).filter((page) => page.favorited === true && !page.archived);
    if (favorites.length > 0) {
      sections.push({
        key: 'favorites',
        label: t('sidebar.sections.favorites'),
        ...sectionState('favorites'),
        droppable: false,
        items: rows(favorites, 'favorite:', canEdit),
      });
    }

    // Teamspaces the reader joined: each a row pages go inside, then browse and create.
    const teamspaceRows: SidebarTreeItem[] = grouped.teamspaces.map(
      ({ teamspace, pages: list, databases: dbs }) => {
        const key = `teamspace:${teamspace.id}` as const;
        const editable = hasRole(role, 'editor') || teamspace.role === 'owner';
        const adds = canAddToTeamspace(teamspace, role);
        placed(list, { teamspaceId: teamspace.id }, key);
        return {
          key,
          label: teamspace.name,
          leading: teamspace.icon ? <IconDisplay value={teamspace.icon} size={15} /> : undefined,
          items: [...rows(list, '', editable), ...databaseRows(dbs, pathname, untitled)],
          expandable: true,
          emptyLabel,
          open: !sectionCollapsed[key],
          onOpenChange: (open) => setSectionCollapsed(key, !open),
          droppable: editable,
          dropBeside: false,
          actionsVisibility: 'hover',
          actions: (
            <>
              <Button
                appearance="plain"
                size="xs"
                iconOnly
                accessibilityLabel={t('workspace.teamspaces.settingsFor', { name: teamspace.name })}
                onPress={() => {
                  setSelection(teamspace);
                  teamspaceDialog.open();
                }}
                leadingIcon={RiSettings3Line}
              />
              {adds ? (
                <Button
                  appearance="plain"
                  size="xs"
                  iconOnly
                  accessibilityLabel={t('sidebar.addToSection', { title: teamspace.name })}
                  onPress={() =>
                    openNewPage({ workspaceId, parentId: null, teamspaceId: teamspace.id })
                  }
                  leadingIcon={RiAddLine}
                />
              ) : null}
            </>
          ),
        };
      },
    );
    const openTeamspaces = (next: TeamspaceSelection) => {
      setSelection(next);
      teamspaceDialog.open();
    };
    sections.push({
      key: 'teamspaces',
      label: t('workspace.teamspaces.title'),
      loading: teamspaces.isPending,
      error: teamspaces.error
        ? apiErrorMessage(teamspaces.error, t('sidebar.loadPagesFailed'))
        : undefined,
      items: [
        ...teamspaceRows,
        {
          key: 'teamspaces:browse',
          label: t('workspace.teamspaces.browse'),
          icon: RiCompass3Line,
          onPress: () => openTeamspaces('browse'),
          droppable: false,
          dropBeside: false,
        },
        ...(canEdit
          ? [
              {
                key: 'teamspaces:create',
                label: t('workspace.teamspaces.create'),
                icon: RiAddLine,
                onPress: () => openTeamspaces('create'),
                droppable: false,
                dropBeside: false,
              },
            ]
          : []),
      ],
    });

    // The reader's own pages.
    placed(grouped.privatePages, { teamspaceId: null }, 'section:private');
    sections.push({
      key: 'private',
      label: t('sidebar.sections.private'),
      ...sectionState('private'),
      loading: pages.isPending || databases.isPending,
      error:
        pages.error || databases.error
          ? apiErrorMessage(pages.error ?? databases.error, t('sidebar.loadPagesFailed'))
          : undefined,
      emptyLabel: t('sidebar.noPrivatePages'),
      actionsVisibility: 'hover',
      actions: role ? (
        <Button
          appearance="plain"
          size="xs"
          iconOnly
          accessibilityLabel={t('sidebar.addToSection', { title: t('sidebar.sections.private') })}
          onPress={() => openNewPage({ workspaceId, parentId: null, teamspaceId: null })}
          leadingIcon={RiAddLine}
        />
      ) : undefined,
      items: [
        ...rows(grouped.privatePages, '', true),
        ...databaseRows(grouped.privateDatabases, pathname, untitled),
      ],
    });

    // Pages of this workspace shared with the reader alone.
    if (grouped.shared.length > 0) {
      sections.push({
        key: 'shared',
        label: t('sidebar.sections.shared'),
        ...sectionState('shared'),
        droppable: false,
        items: rows(grouped.shared, 'shared:', false),
      });
    }

    // Templates: open one, or start a page from it.
    const templatePages = templates.data?.pages ?? [];
    sections.push({
      key: 'templates',
      label: t('sidebar.sections.templates'),
      ...sectionState('templates'),
      droppable: false,
      loading: templates.isLoading,
      error: templates.isError ? t('pages.templates.loadFailed') : undefined,
      emptyLabel: t('pages.templates.empty'),
      items: templatePages.map((page) => {
        const title = page.title.trim() || untitled;
        return {
          key: `template:${page.id}`,
          label: title,
          leading: <IconDisplay value={page.icon} size={15} showPlaceholder pageId={page.id} />,
          href: `/p/${page.id}`,
          selected: pathname === `/p/${page.id}`,
          actionsVisibility: 'hover' as const,
          actions: (
            <Button
              appearance="plain"
              size="xs"
              accessibilityLabel={t('pages.templates.useNamed', { title })}
              disabled={duplicate.isPending}
              onPress={() =>
                duplicate.mutate(
                  { id: page.id, workspaceId, fromTemplate: true, parentId: null },
                  {
                    onSuccess: (created) => router.push(`/p/${created.id}`),
                    onError: (error) =>
                      toast.error(apiErrorMessage(error, t('pages.templates.createFailed'))),
                  },
                )
              }
            >
              {t('pages.templates.use')}
            </Button>
          ),
        };
      }),
    });

    return { tree: sections, routes };
  }, [
    workspaceId,
    t,
    role,
    pathname,
    expanded,
    onExpandedChange,
    shared.data,
    allPages,
    recentIds,
    sectionState,
    grouped,
    sectionCollapsed,
    setSectionCollapsed,
    openNewPage,
    teamspaceDialog,
    teamspaces.isPending,
    teamspaces.error,
    pages.isPending,
    pages.error,
    databases.isPending,
    databases.error,
    templates.data,
    templates.isLoading,
    templates.isError,
    duplicate,
    router,
  ]);

  const onTreeItemDrop = React.useCallback(
    ({ item, target, position, section }: SidebarTreeDrop) => {
      const sourceId = item.key;
      let moves: PageMove[] | null = null;
      if (!target) {
        const destination = routes.get(`section:${section.key ?? section.label}`);
        if (destination) moves = planSectionDrop({ ...destination, sourceId });
      } else if (target.key.startsWith('teamspace:')) {
        const destination = routes.get(target.key);
        if (destination) moves = planSectionDrop({ ...destination, sourceId });
      } else {
        const destination = routes.get(target.key);
        if (destination)
          moves = planSidebarDrop({ ...destination, sourceId, targetId: target.key, position });
      }
      for (const move of moves ?? []) updatePage.mutate({ id: move.id, ...move.patch });
    },
    [routes, updatePage],
  );

  const dialogs = workspaceId ? (
    <TeamspaceDialog
      control={teamspaceDialog}
      workspaceId={workspaceId}
      selection={selection}
      onSelect={setSelection}
    />
  ) : null;

  return { tree, onTreeItemDrop, dialogs };
}
