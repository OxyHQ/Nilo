import React from 'react';
import { View, Pressable } from 'react-native';
import { RiArrowDownSLine } from '@oxy.so/bloom/icons/RiArrowDownSLine';
import { RiAddLine } from '@oxy.so/bloom/icons/RiAddLine';
import { RiCheckLine } from '@oxy.so/bloom/icons/RiCheckLine';
import { Button } from '@oxy.so/bloom/button';
import { useDialogControl } from '@oxy.so/bloom/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@oxy.so/bloom/dropdown-menu';
import { Text } from '@oxy.so/bloom/typography';
import { useColorScheme } from '@/lib/useColorScheme';
import { useWorkspaces, type Workspace } from '@/lib/hooks/use-workspaces';
import { useWorkspaceStore } from '@/lib/stores/workspace-store';
import { CreateWorkspaceModal } from './create-workspace-modal';
import { WorkspaceAvatar } from './workspace-avatar';
import { roleLabel } from './role-labels';
import { useTranslation } from '@/hooks/useTranslation';

interface WorkspaceSwitcherProps {
  /**
   * When true, render a compact icon-only trigger sized for the
   * collapsed sidebar (`width: 48`). Defaults to the full trigger.
   */
  collapsed?: boolean;
}

export const WorkspaceSwitcher = React.memo(function WorkspaceSwitcher({
  collapsed = false,
}: WorkspaceSwitcherProps) {
  const { colors } = useColorScheme();
  const { t } = useTranslation();
  const createDialog = useDialogControl();

  const { data: workspaces, isLoading } = useWorkspaces();
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const setCurrentWorkspaceId = useWorkspaceStore((s) => s.setCurrentWorkspaceId);

  // Resolve the active workspace: prefer the persisted id; otherwise
  // default to the personal workspace, then the first available.
  const activeWorkspace = React.useMemo<Workspace | null>(() => {
    if (!workspaces || workspaces.length === 0) return null;
    const byId = workspaces.find((w) => w.id === currentWorkspaceId);
    if (byId) return byId;
    const personal = workspaces.find((w) => w.isPersonal);
    return personal ?? workspaces[0] ?? null;
  }, [workspaces, currentWorkspaceId]);

  // Sync persisted selection to a real workspace once the list loads.
  // If the persisted id doesn't appear in the response (deleted /
  // unauthorized / first load) we fall back to the personal workspace
  // so downstream consumers (page tree, page detail) always have a
  // valid `currentWorkspaceId`.
  React.useEffect(() => {
    if (!activeWorkspace) return;
    if (currentWorkspaceId === activeWorkspace.id) return;
    setCurrentWorkspaceId(activeWorkspace.id);
  }, [activeWorkspace, currentWorkspaceId, setCurrentWorkspaceId]);

  const handleSelect = React.useCallback(
    (id: string) => {
      setCurrentWorkspaceId(id);
    },
    [setCurrentWorkspaceId],
  );

  const handleCreate = React.useCallback(() => {
    createDialog.open();
  }, [createDialog]);

  const handleCreated = React.useCallback(
    (workspace: Workspace) => {
      setCurrentWorkspaceId(workspace.id);
    },
    [setCurrentWorkspaceId],
  );

  // Empty state: no workspaces (shouldn't happen, backend auto-creates).
  if (!isLoading && (!workspaces || workspaces.length === 0)) {
    return (
      <View className={collapsed ? '' : 'flex-1'}>
        <Button
          appearance="subtle"
          iconOnly={collapsed}
          onPress={handleCreate}
          accessibilityLabel={t('workspace.switcher.createFirst')}
          leadingIcon={RiAddLine}
        >
          {collapsed ? undefined : t('workspace.create.submit')}
        </Button>
        <CreateWorkspaceModal control={createDialog} onCreated={handleCreated} />
      </View>
    );
  }

  const triggerLabel = activeWorkspace?.name ?? t('workspace.fallbackName');

  return (
    <View className={collapsed ? '' : 'flex-1 min-w-0'}>
      <DropdownMenu>
        {/* Bloom wraps a trigger in a box that hugs its content; the row spans the sidebar. */}
        <DropdownMenuTrigger asChild style={{ alignSelf: 'stretch' }}>
          <Pressable
            className={
              collapsed
                ? 'h-10 w-10 items-center justify-center rounded-xl hover:bg-muted'
                : 'h-9 flex-row items-center gap-2 px-1.5 rounded-lg hover:bg-muted'
            }
            accessibilityLabel={t('workspace.switcher.switchLabel', { name: triggerLabel })}
            accessibilityRole="button"
          >
            {activeWorkspace ? (
              <WorkspaceAvatar workspace={activeWorkspace} size={collapsed ? 28 : 24} />
            ) : (
              <View
                className="rounded-md bg-muted"
                style={{
                  width: collapsed ? 28 : 24,
                  height: collapsed ? 28 : 24,
                }}
              />
            )}
            {!collapsed && (
              <>
                <Text
                  className="text-sm font-semibold text-foreground flex-1"
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {triggerLabel}
                </Text>
                <RiArrowDownSLine
                  width={14}
                  height={14}
                  fill={colors.mutedForeground}
                  style={{ flexShrink: 0 }}
                />
              </>
            )}
          </Pressable>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>{t('workspace.switcher.yourWorkspaces')}</DropdownMenuLabel>
          {(workspaces ?? []).map((workspace) => {
            const isActive = workspace.id === activeWorkspace?.id;
            const role = workspace.role;
            return (
              <DropdownMenuItem
                key={workspace.id}
                onPress={() => handleSelect(workspace.id)}
                accessibilityLabel={workspace.name}
                leading={<WorkspaceAvatar workspace={workspace} size={24} />}
                trailing={
                  isActive ? (
                    <RiCheckLine size="sm" fill={colors.foreground} style={{ flexShrink: 0 }} />
                  ) : undefined
                }
              >
                <View className="flex-1 min-w-0">
                  <Text variant="body-medium" numberOfLines={1}>
                    {workspace.name}
                  </Text>
                  {role ? (
                    <Text className="text-[11px] text-muted-foreground">{roleLabel(role)}</Text>
                  ) : null}
                </View>
              </DropdownMenuItem>
            );
          })}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onPress={handleCreate}
            leading={<RiAddLine width={14} height={14} fill={colors.foreground} />}
          >
            {t('workspace.create.title')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CreateWorkspaceModal control={createDialog} onCreated={handleCreated} />
    </View>
  );
});
