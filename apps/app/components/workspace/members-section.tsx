import React from 'react';
import { Text as RNText, View, Platform } from 'react-native';
import { useOxy } from '@oxy.so/services';
import { UserPlus, MoreHorizontal, Trash2 } from 'lucide-react-native';
import { Avatar } from '@oxy.so/bloom/avatar';
import { Button } from '@oxy.so/bloom/button';
import { useDialogControl } from '@oxy.so/bloom/dialog';
import { Divider } from '@oxy.so/bloom/divider';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@oxy.so/bloom/dropdown-menu';
import { EmptyState } from '@oxy.so/bloom/empty-state';
import { Item } from '@oxy.so/bloom/item';
import { Loading } from '@oxy.so/bloom/loading';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemText,
  SelectTrigger,
  SelectValue,
} from '@oxy.so/bloom/select';
import { toast } from '@oxy.so/bloom/toast';
import { Text } from '@oxy.so/bloom/typography';
import { useColorScheme } from '@/lib/useColorScheme';
import { useWorkspaces } from '@/lib/hooks/use-workspaces';
import { useWorkspaceStore } from '@/lib/stores/workspace-store';
import {
  memberProfileName,
  useWorkspaceMembers,
  useRemoveMember,
  useUpdateMemberRole,
  type WorkspaceMember,
} from '@/lib/hooks/use-workspace-members';
import type { WorkspaceRole } from '@/lib/hooks/use-workspaces';
import { WORKSPACE_ROLES, hasRole } from '@/lib/hooks/workspace-roles';
import { InviteMemberModal } from './invite-member-modal';
import { roleLabel } from './role-labels';
import { useTranslation } from '@/hooks/useTranslation';

const ASSIGNABLE_ROLES: WorkspaceRole[] = ['viewer', 'commenter', 'editor', 'admin'];

function memberDisplayName(member: WorkspaceMember): string {
  return memberProfileName(member) ?? member.userId;
}

function memberInitial(member: WorkspaceMember): string {
  const profile = member.user;
  const source = profile?.name?.first?.[0] ?? profile?.username?.[0] ?? profile?.email?.[0] ?? '?';
  return source.toUpperCase();
}

function MemberAvatar({ member }: { member: WorkspaceMember }) {
  // `source` is the bare Oxy file id: the resolver mounted in the root layout
  // turns it into the thumb rendition's URL.
  return <Avatar source={member.user?.avatar ?? null} initials={memberInitial(member)} size="lg" />;
}

interface MemberRowProps {
  member: WorkspaceMember;
  workspaceId: string;
  /** Role of the viewer for this workspace. Drives action permissions. */
  callerRole: WorkspaceRole | undefined;
  /** Oxy user id of the viewer. Disables self-removal. */
  callerUserId: string | undefined;
}

function MemberRow({ member, workspaceId, callerRole, callerUserId }: MemberRowProps) {
  const { colors } = useColorScheme();
  const { t } = useTranslation();
  const { mutate: updateRole, isPending: isUpdating } = useUpdateMemberRole(workspaceId);
  const { mutate: removeMember, isPending: isRemoving } = useRemoveMember(workspaceId);

  const isOwner = member.role === 'owner';
  const isSelf = callerUserId === member.userId;
  // Only admin+ can manage members. Owners can't be demoted via this UI.
  const canManage = hasRole(callerRole, 'admin') && !isOwner && !isSelf;

  const handleChangeRole = React.useCallback(
    (role: WorkspaceRole) => {
      if (role === member.role) return;
      updateRole(
        { userId: member.userId, role },
        {
          onSuccess: () => {
            toast.success(
              t('workspace.members.roleUpdated', {
                role: roleLabel(role),
                name: memberDisplayName(member),
              }),
            );
          },
          onError: (error) => {
            const message =
              error instanceof Error && error.message
                ? error.message
                : t('workspace.members.roleUpdateFailed');
            toast.error(message);
          },
        },
      );
    },
    [updateRole, member, t],
  );

  const handleRemove = React.useCallback(() => {
    removeMember(member.userId, {
      onSuccess: () => {
        toast.success(t('workspace.members.removed', { name: memberDisplayName(member) }));
      },
      onError: (error) => {
        const message =
          error instanceof Error && error.message
            ? error.message
            : t('workspace.members.removeFailed');
        toast.error(message);
      },
    });
  }, [removeMember, member, t]);

  const roleItems = ASSIGNABLE_ROLES.map((role) => ({ value: role, label: roleLabel(role) }));

  return (
    <Item
      leading={<MemberAvatar member={member} />}
      title={
        <Text variant="body-medium" numberOfLines={1}>
          {memberDisplayName(member)}
          {isSelf ? (
            <RNText className="text-xs text-muted-foreground"> {t('workspace.members.you')}</RNText>
          ) : null}
        </Text>
      }
      subtitle={member.user?.email || undefined}
      trailing={
        canManage ? (
          <View className="flex-row items-center gap-1 shrink-0">
            <Select
              size="sm"
              value={member.role}
              onValueChange={(role) => handleChangeRole(role as WorkspaceRole)}
              disabled={isUpdating || isRemoving}
            >
              <SelectTrigger
                label={t('workspace.members.changeRole', { name: memberDisplayName(member) })}
                disabled={isUpdating || isRemoving}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent
                items={roleItems}
                renderItem={(item) => (
                  <SelectItem value={item.value} label={item.label}>
                    <SelectItemText>{item.label}</SelectItemText>
                  </SelectItem>
                )}
              />
            </Select>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  appearance="subtle"
                  size="sm"
                  iconOnly
                  accessibilityLabel={t('workspace.members.moreActions', {
                    name: memberDisplayName(member),
                  })}
                  disabled={isUpdating || isRemoving}
                  renderLeadingIcon={({ size, color }) => (
                    <MoreHorizontal size={size} color={color} />
                  )}
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem
                  variant="destructive"
                  onPress={handleRemove}
                  leading={<Trash2 size={16} color={colors.mutedForeground} />}
                >
                  {t('workspace.members.remove')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </View>
        ) : (
          <View className="h-8 px-2 items-center justify-center shrink-0">
            <Text className="text-xs font-medium text-muted-foreground">
              {roleLabel(member.role)}
            </Text>
          </View>
        )
      }
    />
  );
}

export function MembersSection() {
  const { user } = useOxy();
  const { t } = useTranslation();
  const inviteDialog = useDialogControl();
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);

  const { data: workspaces } = useWorkspaces();
  const currentWorkspace = React.useMemo(
    () => workspaces?.find((w) => w.id === currentWorkspaceId) ?? null,
    [workspaces, currentWorkspaceId],
  );

  const { data: members, isLoading, isError, error } = useWorkspaceMembers(currentWorkspaceId);

  const callerRole = currentWorkspace?.role;
  const canInvite = hasRole(callerRole, 'admin');

  // Sort: owners first, then by role rank (desc), then by joinedAt asc.
  const sortedMembers = React.useMemo(() => {
    if (!members) return [];
    return [...members].sort((a, b) => {
      const roleDelta = WORKSPACE_ROLES.indexOf(b.role) - WORKSPACE_ROLES.indexOf(a.role);
      if (roleDelta !== 0) return roleDelta;
      return new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime();
    });
  }, [members]);

  return (
    <View className="gap-3">
      <View className="flex-row items-center justify-between">
        <View className="flex-1 min-w-0">
          <Text variant="body-medium">{currentWorkspace?.name ?? t('workspace.fallbackName')}</Text>
          <Text className="text-xs text-muted-foreground">
            {t('workspace.members.count', { count: members?.length ?? 0 })}
          </Text>
        </View>
        {canInvite && currentWorkspaceId ? (
          <Button
            appearance="solid"
            tone="accent"
            size="sm"
            onPress={() => inviteDialog.open()}
            renderLeadingIcon={({ size, color }) => <UserPlus size={size} color={color} />}
          >
            {t('workspace.members.invite')}
          </Button>
        ) : null}
      </View>

      <View className="rounded-xl border border-border bg-card overflow-hidden">
        {isLoading ? (
          <View className="py-10 items-center justify-center">
            <Loading variant="spinner" accessibilityLabel={t('common.loading')} />
          </View>
        ) : isError ? (
          <View className="py-6 px-4">
            <Text className="text-sm text-destructive">
              {error instanceof Error ? error.message : t('workspace.members.loadFailed')}
            </Text>
          </View>
        ) : sortedMembers.length === 0 ? (
          <EmptyState variant="compact" description={t('workspace.members.empty')} />
        ) : (
          <View className="px-1 py-1">
            {sortedMembers.map((member, idx) => (
              <View key={member.userId}>
                {idx > 0 ? <Divider style={{ marginHorizontal: 8 }} /> : null}
                <MemberRow
                  member={member}
                  workspaceId={currentWorkspaceId ?? ''}
                  callerRole={callerRole}
                  callerUserId={user?.id}
                />
              </View>
            ))}
          </View>
        )}
      </View>

      {currentWorkspaceId ? (
        <InviteMemberModal control={inviteDialog} workspaceId={currentWorkspaceId} />
      ) : null}

      {!canInvite && currentWorkspace ? (
        <View
          className={
            Platform.OS === 'web'
              ? 'rounded-lg bg-muted/40 px-3 py-2'
              : 'rounded-lg bg-muted px-3 py-2'
          }
        >
          <Text className="text-xs text-muted-foreground">{t('workspace.members.adminOnly')}</Text>
        </View>
      ) : null}
    </View>
  );
}
