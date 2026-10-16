import React from 'react';
import { Text as RNText, View } from 'react-native';
import { useOxy } from '@oxy.so/services';
import { Avatar } from '@oxy.so/bloom/avatar';
import { Button } from '@oxy.so/bloom/button';
import { useDialogControl } from '@oxy.so/bloom/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@oxy.so/bloom/dropdown-menu';
import { RiMoreLine } from '@oxy.so/bloom/icons/RiMoreLine';
import { RiUserAddLine } from '@oxy.so/bloom/icons/RiUserAddLine';
import { Loading } from '@oxy.so/bloom/loading';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemText,
  SelectTrigger,
  SelectValue,
} from '@oxy.so/bloom/select';
import { SettingsCard, SettingsRow, SettingsSection } from '@oxy.so/bloom/settings-modal/modal';
import { toast } from '@oxy.so/bloom/toast';
import { Text } from '@oxy.so/bloom/typography';
import { cn } from '@/lib/utils';
import { useCurrentWorkspace } from '@/lib/hooks/use-workspaces';
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

interface MemberRowProps {
  member: WorkspaceMember;
  workspaceId: string;
  /** Role of the viewer for this workspace. Drives action permissions. */
  callerRole: WorkspaceRole | undefined;
  /** Oxy user id of the viewer. Disables self-removal. */
  callerUserId: string | undefined;
  /** The last row of the card draws no separator under it. */
  last: boolean;
}

function MemberRow({ member, workspaceId, callerRole, callerUserId, last }: MemberRowProps) {
  const { t } = useTranslation();
  const { mutate: updateRole, isPending: isUpdating } = useUpdateMemberRole(workspaceId);
  const { mutate: removeMember, isPending: isRemoving } = useRemoveMember(workspaceId);

  const isOwner = member.role === 'owner';
  const isSelf = callerUserId === member.userId;
  // Only admin+ can manage members. Owners can't be demoted via this UI.
  const canManage = hasRole(callerRole, 'admin') && !isOwner && !isSelf;
  const name = memberDisplayName(member);
  const roles = ASSIGNABLE_ROLES.map((role) => ({ value: role, label: roleLabel(role) }));

  const handleChangeRole = React.useCallback(
    (role: WorkspaceRole) => {
      if (role === member.role) return;
      updateRole(
        { userId: member.userId, role },
        {
          onSuccess: () => {
            toast.success(t('workspace.members.roleUpdated', { role: roleLabel(role), name }));
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
    [updateRole, member, name, t],
  );

  const handleRemove = React.useCallback(() => {
    removeMember(member.userId, {
      onSuccess: () => {
        toast.success(t('workspace.members.removed', { name }));
      },
      onError: (error) => {
        const message =
          error instanceof Error && error.message
            ? error.message
            : t('workspace.members.removeFailed');
        toast.error(message);
      },
    });
  }, [removeMember, member, name, t]);

  // A member row carries an avatar, which `SettingsRow` has no slot for, so it
  // draws the row's geometry itself.
  return (
    <View
      className={cn(
        'min-h-[52px] flex-row items-center gap-3 py-2.5 pr-2.5',
        last ? '' : 'border-b border-border',
      )}
    >
      <Avatar source={member.user?.avatar ?? undefined} name={name} size={32} />
      <View className="flex-1 min-w-0">
        <Text variant="body-medium" numberOfLines={1}>
          {name}
          {isSelf ? (
            <RNText className="text-xs text-muted-foreground"> {t('workspace.members.you')}</RNText>
          ) : null}
        </Text>
        {member.user?.email ? (
          <Text className="text-xs text-muted-foreground" numberOfLines={1} ellipsizeMode="tail">
            {member.user.email}
          </Text>
        ) : null}
      </View>

      {canManage ? (
        <View className="flex-row items-center gap-1 shrink-0">
          <Select
            size="sm"
            value={member.role}
            disabled={isUpdating || isRemoving}
            onValueChange={(value) => {
              const next = ASSIGNABLE_ROLES.find((role) => role === value);
              if (next) handleChangeRole(next);
            }}
          >
            <SelectTrigger label={t('workspace.members.changeRole', { name })}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent
              items={roles}
              renderItem={(item) => (
                <SelectItem value={item.value} label={item.label}>
                  <SelectItemText>{item.label}</SelectItemText>
                </SelectItem>
              )}
            />
          </Select>

          <DropdownMenu>
            <DropdownMenuTrigger
              asChild
              label={t('workspace.members.moreActions', { name })}
              disabled={isUpdating || isRemoving}
            >
              <Button
                appearance="plain"
                tone="neutral"
                size="sm"
                icon={RiMoreLine}
                accessibilityLabel={t('workspace.members.moreActions', { name })}
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem tone="danger" onPress={handleRemove}>
                {t('workspace.members.remove')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </View>
      ) : (
        <Text className="text-xs font-medium text-muted-foreground shrink-0">
          {roleLabel(member.role)}
        </Text>
      )}
    </View>
  );
}

export function MembersSection() {
  const { user } = useOxy();
  const { t } = useTranslation();
  const inviteDialog = useDialogControl();
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const currentWorkspace = useCurrentWorkspace();

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
    <>
      <SettingsSection
        label={t('workspace.members.count', { count: members?.length ?? 0 })}
        description={
          canInvite ? t('settings.members.description') : t('workspace.members.adminOnly')
        }
        action={
          canInvite && currentWorkspaceId ? (
            <Button
              tone="action"
              size="sm"
              leadingIcon={RiUserAddLine}
              onPress={() => inviteDialog.open()}
            >
              {t('workspace.members.invite')}
            </Button>
          ) : undefined
        }
      >
        <SettingsCard>
          {isLoading ? (
            <View className="py-10 items-center justify-center">
              <Loading variant="spinner" accessibilityLabel={t('common.loading')} />
            </View>
          ) : isError ? (
            <SettingsRow
              label={error instanceof Error ? error.message : t('workspace.members.loadFailed')}
            />
          ) : sortedMembers.length === 0 ? (
            <SettingsRow label={t('workspace.members.empty')} />
          ) : (
            sortedMembers.map((member, idx) => (
              <MemberRow
                key={member.userId}
                member={member}
                workspaceId={currentWorkspaceId ?? ''}
                callerRole={callerRole}
                callerUserId={user?.id}
                last={idx === sortedMembers.length - 1}
              />
            ))
          )}
        </SettingsCard>
      </SettingsSection>

      {currentWorkspaceId ? (
        <InviteMemberModal control={inviteDialog} workspaceId={currentWorkspaceId} />
      ) : null}
    </>
  );
}
