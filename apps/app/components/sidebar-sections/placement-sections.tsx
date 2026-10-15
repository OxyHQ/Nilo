import { useState } from 'react';
import { View, Pressable } from 'react-native';
import { useOxy } from '@oxy.so/services';
import { useRouter } from 'expo-router';
import { Settings } from 'lucide-react-native';
import { Text } from '@/components/ui/text';
import { Button } from '@/components/ui/button';
import { TeamspaceDialog } from '@/components/teamspaces/teamspace-dialog';
import { useTranslation } from '@/hooks/useTranslation';
import { usePages } from '@/lib/hooks/use-pages';
import { useDatabases } from '@/lib/hooks/use-databases';
import { canAddToTeamspace, useTeamspaces, type Teamspace } from '@/lib/hooks/use-teamspaces';
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
  const [dialog, setDialog] = useState<'browse' | 'create' | Teamspace | null>(null);
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
          <Text className="px-3 text-sm">{t('common.loading')}</Text>
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
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('workspace.teamspaces.settingsFor', { name: teamspace.name })}
                onPress={() => setDialog(teamspace)}
                className="h-7 w-7 items-center justify-center rounded-md hover:bg-muted"
              >
                <Settings size={14} className="text-muted-foreground" />
              </Pressable>
            }
          >
            <SidebarPageTree
              pages={tree}
              workspaceId={workspaceId}
              readOnly={!hasRole(role, 'editor') && teamspace.role !== 'owner'}
            />
            <DatabaseRows databases={dbs} />
          </SidebarSection>
        ))}
        <Button
          variant="ghost"
          accessibilityLabel={t('workspace.teamspaces.browse')}
          onPress={() => setDialog('browse')}
        >
          <Text className="text-sm text-muted-foreground">{t('workspace.teamspaces.browse')}</Text>
        </Button>
        {hasRole(role, 'editor') ? (
          <Button
            variant="ghost"
            accessibilityLabel={t('workspace.teamspaces.create')}
            onPress={() => setDialog('create')}
          >
            <Text className="text-sm text-muted-foreground">
              {t('workspace.teamspaces.create')}
            </Text>
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
        />
        <DatabaseRows databases={grouped.privateDatabases} />
      </SidebarSection>
      {grouped.shared.length ? (
        <SidebarSection sectionKey="shared" title={t('sidebar.sections.shared')}>
          <SidebarPageTree pages={grouped.shared} workspaceId={workspaceId} enableDrag={false} />
        </SidebarSection>
      ) : null}
      {dialog ? (
        <TeamspaceDialog
          workspaceId={workspaceId}
          initial={dialog}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </>
  );
}

function DatabaseRows({ databases }: { databases: Database[] }) {
  const router = useRouter();
  const { t } = useTranslation();
  return (
    <View>
      {databases.map((database) => (
        <Pressable
          key={database.id}
          accessibilityRole="link"
          accessibilityLabel={database.name || t('workspace.teamspaces.newDatabase')}
          onPress={() => router.push(`/db/${database.id}`)}
          className="mx-2 rounded-md px-3 py-2 hover:bg-muted"
        >
          <Text className="text-sm" numberOfLines={1}>
            {database.icon} {database.name || t('workspace.teamspaces.newDatabase')}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
