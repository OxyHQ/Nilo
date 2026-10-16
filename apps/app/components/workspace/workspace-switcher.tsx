import React from 'react';
import { View, Pressable, Platform } from 'react-native';
import { ChevronDown, Plus, Check } from 'lucide-react-native';
import { Text } from '@/components/ui/text';
import * as DropdownMenu from '@/components/ui/dropdown-menu';
import { useColorScheme } from '@/lib/useColorScheme';
import { useImageResolver } from '@oxy.so/bloom/image-resolver';
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
  const resolveImage = useImageResolver();
  const [createOpen, setCreateOpen] = React.useState(false);

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
    setCreateOpen(true);
  }, []);

  const handleCreated = React.useCallback(
    (workspace: Workspace) => {
      setCurrentWorkspaceId(workspace.id);
      setCreateOpen(false);
    },
    [setCurrentWorkspaceId],
  );

  // Empty state: no workspaces (shouldn't happen, backend auto-creates).
  if (!isLoading && (!workspaces || workspaces.length === 0)) {
    return (
      <View className={collapsed ? '' : 'flex-1'}>
        <Pressable
          onPress={handleCreate}
          className="h-9 flex-row items-center gap-2 px-2 rounded-lg hover:bg-muted"
          accessibilityLabel={t('workspace.switcher.createFirst')}
          accessibilityRole="button"
        >
          <Plus size={16} color={colors.mutedForeground} />
          {!collapsed && (
            <Text className="text-sm text-muted-foreground">{t('workspace.create.submit')}</Text>
          )}
        </Pressable>
        <CreateWorkspaceModal
          open={createOpen}
          onOpenChange={setCreateOpen}
          onCreated={handleCreated}
        />
      </View>
    );
  }

  const triggerLabel = activeWorkspace?.name ?? t('workspace.fallbackName');

  return (
    <View className={collapsed ? '' : 'flex-1 min-w-0'}>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
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
                <ChevronDown size={14} color={colors.mutedForeground} style={{ flexShrink: 0 }} />
              </>
            )}
          </Pressable>
        </DropdownMenu.Trigger>
        <DropdownMenu.Content>
          {Platform.OS === 'web' ? (
            <View className="px-2 pt-2 pb-1">
              <Text className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                {t('workspace.switcher.yourWorkspaces')}
              </Text>
            </View>
          ) : (
            <DropdownMenu.Label>{t('workspace.switcher.yourWorkspaces')}</DropdownMenu.Label>
          )}
          {(workspaces ?? []).map((workspace) => {
            const isActive = workspace.id === activeWorkspace?.id;
            const role = workspace.role;
            const imageUri = workspace.avatar
              ? resolveImage?.(workspace.avatar, 'thumb')
              : undefined;
            return (
              <DropdownMenu.Item key={workspace.id} onSelect={() => handleSelect(workspace.id)}>
                {Platform.OS === 'web' ? (
                  <View className="flex-row items-center gap-2 w-full">
                    <WorkspaceAvatar workspace={workspace} size={24} />
                    <View className="flex-1 min-w-0">
                      <Text className="text-sm font-medium text-foreground" numberOfLines={1}>
                        {workspace.name}
                      </Text>
                      {role ? (
                        <Text className="text-[11px] text-muted-foreground">{roleLabel(role)}</Text>
                      ) : null}
                    </View>
                    {isActive ? (
                      <Check size={16} color={colors.foreground} style={{ flexShrink: 0 }} />
                    ) : null}
                  </View>
                ) : (
                  <>
                    {/* A system menu draws no React views, so the row shows the
                        picture itself and nothing when there is none. */}
                    {imageUri ? (
                      <DropdownMenu.ItemImage
                        source={{ uri: imageUri }}
                        ios={{ style: { cornerRadius: 6 } }}
                      />
                    ) : null}
                    <DropdownMenu.ItemTitle>{workspace.name}</DropdownMenu.ItemTitle>
                    {role ? (
                      <DropdownMenu.ItemSubtitle>{roleLabel(role)}</DropdownMenu.ItemSubtitle>
                    ) : null}
                  </>
                )}
              </DropdownMenu.Item>
            );
          })}
          <DropdownMenu.Separator />
          <DropdownMenu.Item key="create" onSelect={handleCreate}>
            {Platform.OS === 'web' ? (
              <View className="flex-row items-center gap-2">
                <Plus size={14} color={colors.foreground} />
                <Text className="text-sm font-medium text-foreground">
                  {t('workspace.create.title')}
                </Text>
              </View>
            ) : (
              <>
                <DropdownMenu.ItemIcon ios={{ name: 'plus' }} />
                <DropdownMenu.ItemTitle>{t('workspace.create.title')}</DropdownMenu.ItemTitle>
              </>
            )}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
      <CreateWorkspaceModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={handleCreated}
      />
    </View>
  );
});
