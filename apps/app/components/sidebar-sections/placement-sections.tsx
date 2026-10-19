import { useState } from 'react';
import { View } from 'react-native';
import { useOxy } from '@oxy.so/services/ui/client';
import { useRouter } from 'expo-router';
import { RiSettings3Line } from '@oxy.so/bloom/icons/RiSettings3Line';
import { Button } from '@oxy.so/bloom/button';
import { useDialogControl } from '@oxy.so/bloom/dialog';
import { Item } from '@oxy.so/bloom/item';
import { Loading } from '@oxy.so/bloom/loading';
import { Text } from '@oxy.so/bloom/typography';
import { TeamspaceDialog, type TeamspaceSelection } from '@/components/teamspaces/teamspace-dialog';
import { useTranslation } from '@/hooks/useTranslation';
import { usePages } from '@/lib/hooks/use-pages';
import { useDatabases } from '@/lib/hooks/use-databases';
import { canAddToTeamspace, useTeamspaces } from '@/lib/hooks/use-teamspaces';
import { useWorkspaceRole } from '@/lib/hooks/use-workspaces';
import { hasRole } from '@/lib/hooks/workspace-roles';
import { useWorkspaceStore } from '@/lib/stores/workspace-store';
import { useNewPageStore } from '@/lib/stores/new-page-store';
import { groupSidebar } from '@/lib/sidebar-groups';
import { apiErrorMessage } from '@/lib/api/error-message';
import type { Database } from '@/lib/types/databases';
import { SidebarSection } from './sidebar-section';
import { SidebarPageTree } from './sidebar-page-tree';

export function PlacementSections() {
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  if (!workspaceId) return null;
  return <WorkspacePlacements key={workspaceId} workspaceId={workspaceId} />;
}

function WorkspacePlacements({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation();
  const { user } = useOxy();
  const pages = usePages(workspaceId);
  const databases = useDatabases(workspaceId);
  const teamspaces = useTeamspaces(workspaceId);
  const role = useWorkspaceRole(workspaceId);
  const open = useNewPageStore((s) => s.open);
  const teamspaceDialog = useDialogControl();
  const [selection, setSelection] = useState<TeamspaceSelection>('browse');
  const openDialog = (next: TeamspaceSelection) => {
    setSelection(next);
    teamspaceDialog.open();
  };
  const grouped = groupSidebar(
    pages.data?.pages ?? [],
    databases.data?.databases ?? [],
    teamspaces.data ?? [],
    user?.id ?? '',
  );
  const error = pages.error ?? databases.error ?? teamspaces.error;
  return (
    <>
      <SidebarSection title={t('workspace.teamspaces.title')} collapsible={false}>
        {pages.isPending || databases.isPending || teamspaces.isPending ? (
          <View className="px-3">
            <Loading variant="inline" size="sm" text={t('common.loading')} />
          </View>
        ) : null}
        {error ? (
          <Text accessibilityRole="alert" className="px-3 text-sm text-destructive">
            {apiErrorMessage(error, t('sidebar.loadPagesFailed'))}
          </Text>
        ) : null}
        {grouped.teamspaces.map(({ teamspace, pages: tree, databases: dbs }) => (
          <SidebarSection
            key={teamspace.id}
            sectionKey={`teamspace:${teamspace.id}`}
            title={`${teamspace.icon ?? ''} ${teamspace.name}`.trim()}
            onAdd={
              canAddToTeamspace(teamspace, role)
                ? () => open({ workspaceId, parentId: null, teamspaceId: teamspace.id })
                : undefined
            }
            trailing={
              <Button
                appearance="plain"
                size="xs"
                iconOnly
                accessibilityLabel={t('workspace.teamspaces.settingsFor', { name: teamspace.name })}
                onPress={() => openDialog(teamspace)}
                leadingIcon={RiSettings3Line}
              />
            }
          >
            <SidebarPageTree
              pages={tree}
              workspaceId={workspaceId}
              readOnly={!hasRole(role, 'editor') && teamspace.role !== 'owner'}
              place={{ teamspaceId: teamspace.id }}
            />
            <DatabaseRows databases={dbs} />
          </SidebarSection>
        ))}
        <Button
          appearance="plain"
          size="sm"
          accessibilityLabel={t('workspace.teamspaces.browse')}
          onPress={() => openDialog('browse')}
        >
          {t('workspace.teamspaces.browse')}
        </Button>
        {hasRole(role, 'editor') ? (
          <Button
            appearance="plain"
            size="sm"
            accessibilityLabel={t('workspace.teamspaces.create')}
            onPress={() => openDialog('create')}
          >
            {t('workspace.teamspaces.create')}
          </Button>
        ) : null}
      </SidebarSection>
      <SidebarSection
        sectionKey="private"
        title={t('sidebar.sections.private')}
        onAdd={role ? () => open({ workspaceId, parentId: null, teamspaceId: null }) : undefined}
      >
        <SidebarPageTree
          pages={grouped.privatePages}
          workspaceId={workspaceId}
          emptyText={t('sidebar.noPrivatePages')}
          place={{ teamspaceId: null }}
        />
        <DatabaseRows databases={grouped.privateDatabases} />
      </SidebarSection>
      {grouped.shared.length ? (
        <SidebarSection sectionKey="shared" title={t('sidebar.sections.shared')}>
          <SidebarPageTree pages={grouped.shared} workspaceId={workspaceId} enableDrag={false} />
        </SidebarSection>
      ) : null}
      <TeamspaceDialog
        control={teamspaceDialog}
        workspaceId={workspaceId}
        selection={selection}
        onSelect={setSelection}
      />
    </>
  );
}

function DatabaseRows({ databases }: { databases: Database[] }) {
  const router = useRouter();
  const { t } = useTranslation();
  return (
    <View>
      {databases.map((database) => (
        <Item
          key={database.id}
          density="compact"
          accessibilityRole="link"
          accessibilityLabel={database.name || t('workspace.teamspaces.newDatabase')}
          onPress={() => router.push(`/db/${database.id}`)}
          title={`${database.icon ?? ''} ${database.name || t('workspace.teamspaces.newDatabase')}`.trim()}
        />
      ))}
    </View>
  );
}
