import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useOxy } from '@oxy.so/services';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useTranslation } from '@/hooks/useTranslation';
import { apiErrorMessage } from '@/lib/api/error-message';
import {
  type Teamspace,
  type TeamspacePrivacy,
  useTeamspaces,
  useTeamspaceMembers,
  useTeamspaceMutation,
} from '@/lib/hooks/use-teamspaces';
import { useWorkspaceRole } from '@/lib/hooks/use-workspaces';
import { hasRole } from '@/lib/hooks/workspace-roles';
import { useWorkspaceMembers } from '@/lib/hooks/use-workspace-members';
import { profileName, useMemberProfiles } from '@/lib/hooks/use-member-profiles';

export function TeamspaceDialog({
  workspaceId,
  initial,
  onClose,
}: {
  workspaceId: string;
  initial: 'browse' | 'create' | Teamspace;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [selection, setSelection] = useState(initial);
  const teamspaces = useTeamspaces(workspaceId);
  const role = useWorkspaceRole(workspaceId);
  const mutation = useTeamspaceMutation(workspaceId);
  const selected =
    typeof selection === 'object'
      ? (teamspaces.data?.find((space) => space.id === selection.id) ?? selection)
      : null;
  const title = t(
    selection === 'browse'
      ? 'workspace.teamspaces.browse'
      : selection === 'create'
        ? 'workspace.teamspaces.create'
        : 'workspace.teamspaces.settings',
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        accessibilityLabel={title}
        className="max-w-lg gap-3 p-4"
        showCloseButton={false}
      >
        <View className="flex-row items-center justify-between gap-2">
          <DialogTitle>{title}</DialogTitle>
          <Button variant="ghost" accessibilityLabel={t('common.close')} onPress={onClose}>
            <Text>{t('common.close')}</Text>
          </Button>
        </View>
        <ScrollView className="max-h-[32rem]" keyboardShouldPersistTaps="handled">
          {selection === 'browse' ? (
            <View className="gap-3">
              {hasRole(role, 'editor') ? (
                <Button
                  accessibilityLabel={t('workspace.teamspaces.create')}
                  onPress={() => setSelection('create')}
                >
                  <Text>{t('workspace.teamspaces.create')}</Text>
                </Button>
              ) : null}
              {teamspaces.isPending ? <Text>{t('common.loading')}</Text> : null}
              {teamspaces.isError ? (
                <Text accessibilityRole="alert">
                  {apiErrorMessage(teamspaces.error, t('workspace.teamspaces.failed'))}
                </Text>
              ) : null}
              {teamspaces.data
                ?.filter((space) => !space.archived)
                .map((space) => (
                  <View key={space.id} className="gap-2 rounded-lg border border-border p-3">
                    <Button
                      variant="ghost"
                      accessibilityLabel={space.name}
                      onPress={() => setSelection(space)}
                    >
                      <Text>
                        {space.icon} {space.name}
                      </Text>
                    </Button>
                    <Text className="text-sm text-muted-foreground">
                      {t(`workspace.teamspaces.privacy.${space.privacy}`)}
                    </Text>
                    {space.description ? (
                      <Text className="text-sm">{space.description}</Text>
                    ) : null}
                    {space.role ? (
                      <Text>{t('workspace.teamspaces.joined')}</Text>
                    ) : space.privacy === 'open' ? (
                      <Button
                        variant="outline"
                        disabled={mutation.isPending}
                        accessibilityLabel={t('workspace.teamspaces.joinName', {
                          name: space.name,
                        })}
                        onPress={() => mutation.mutate({ action: 'join', id: space.id })}
                      >
                        <Text>{t('workspace.teamspaces.join')}</Text>
                      </Button>
                    ) : null}
                  </View>
                ))}
              {mutation.isError ? (
                <Text accessibilityRole="alert" className="text-destructive">
                  {apiErrorMessage(mutation.error, t('workspace.teamspaces.failed'))}
                </Text>
              ) : null}
            </View>
          ) : (
            <TeamspaceDetails
              key={selected?.id ?? 'create'}
              workspaceId={workspaceId}
              teamspace={selected}
              onClose={onClose}
            />
          )}
        </ScrollView>
      </DialogContent>
    </Dialog>
  );
}

function TeamspaceDetails({
  workspaceId,
  teamspace,
  onClose,
}: {
  workspaceId: string;
  teamspace: Teamspace | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { user } = useOxy();
  const workspaceRole = useWorkspaceRole(workspaceId);
  const manages = teamspace
    ? teamspace.role === 'owner' || hasRole(workspaceRole, 'admin')
    : hasRole(workspaceRole, 'editor');
  const [name, setName] = useState(teamspace?.name ?? '');
  const [icon, setIcon] = useState(teamspace?.icon ?? '');
  const [description, setDescription] = useState(teamspace?.description ?? '');
  const [privacy, setPrivacy] = useState<TeamspacePrivacy>(teamspace?.privacy ?? 'open');
  const [archiveConfirm, setArchiveConfirm] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');
  const mutation = useTeamspaceMutation(workspaceId);
  const members = useTeamspaceMembers(teamspace?.id ?? null);
  const workspaceMembers = useWorkspaceMembers(manages && teamspace ? workspaceId : null);
  const ids = [...(members.data ?? []), ...(workspaceMembers.data ?? [])].map((m) => m.userId);
  const profiles = useMemberProfiles(ids);
  const memberName = (id: string) =>
    profileName(profiles.data?.find((p) => p.id === id)) ?? t('common.user');
  const owners = members.data?.filter((m) => m.role === 'owner').length ?? 0;
  const lastOwner =
    owners <= 1 && members.data?.some((m) => m.userId === user?.id && m.role === 'owner');
  const busy = mutation.isPending;
  return (
    <View className="gap-3">
      {(['name', 'icon', 'description'] as const).map((field) => (
        <View key={field} className="gap-1">
          <Text className="text-sm font-medium">{t(`workspace.teamspaces.${field}`)}</Text>
          <Input
            accessibilityLabel={t(`workspace.teamspaces.${field}`)}
            value={field === 'name' ? name : field === 'icon' ? icon : description}
            onChangeText={field === 'name' ? setName : field === 'icon' ? setIcon : setDescription}
            maxLength={field === 'description' ? 2000 : 200}
            multiline={field === 'description'}
            editable={manages && !busy}
          />
        </View>
      ))}
      <Text className="text-sm font-medium">{t('workspace.teamspaces.privacyLabel')}</Text>
      {(['open', 'closed', 'private'] as const).map((value) => (
        <View key={value} className="gap-1">
          <Button
            variant={privacy === value ? 'secondary' : 'outline'}
            role="radio"
            accessibilityRole="radio"
            accessibilityState={{ checked: privacy === value }}
            accessibilityLabel={t(`workspace.teamspaces.privacy.${value}`)}
            disabled={!manages || Boolean(teamspace?.isDefault) || busy}
            onPress={() => setPrivacy(value)}
          >
            <Text>{t(`workspace.teamspaces.privacy.${value}`)}</Text>
          </Button>
          <Text className="text-xs text-muted-foreground">
            {t(`workspace.teamspaces.explanation.${value}`)}
          </Text>
        </View>
      ))}
      {teamspace?.isDefault ? (
        <Text className="text-sm text-muted-foreground">
          {t('workspace.teamspaces.defaultInfo')}
        </Text>
      ) : null}
      {manages ? (
        <Button
          disabled={!name.trim() || busy}
          accessibilityLabel={t(teamspace ? 'common.save' : 'workspace.teamspaces.create')}
          onPress={() => {
            const input = {
              name: name.trim(),
              icon: icon.trim() || null,
              description,
              ...(teamspace?.isDefault ? {} : { privacy }),
            };
            mutation.mutate(
              teamspace
                ? { action: 'update', id: teamspace.id, input }
                : { action: 'create', input: { ...input, privacy } },
              { onSuccess: onClose },
            );
          }}
        >
          <Text>{t(teamspace ? 'common.save' : 'workspace.teamspaces.create')}</Text>
        </Button>
      ) : null}
      {teamspace ? (
        <>
          <Text accessibilityRole="header" className="font-semibold">
            {t('workspace.teamspaces.members', { count: members.data?.length ?? 0 })}
          </Text>
          {members.isPending ? <Text>{t('common.loading')}</Text> : null}
          {members.isError ? (
            <Text accessibilityRole="alert">
              {apiErrorMessage(members.error, t('workspace.teamspaces.failed'))}
            </Text>
          ) : null}
          {members.data?.map((member) => {
            const last = member.role === 'owner' && owners <= 1;
            const label = memberName(member.userId);
            return (
              <View key={member.userId} className="gap-2 border-b border-border py-2">
                <Text>{label}</Text>
                <Text className="text-xs text-muted-foreground">
                  {t(`workspace.teamspaces.roles.${member.role}`)}
                </Text>
                {manages ? (
                  <View className="flex-row flex-wrap gap-2">
                    <Button
                      variant="outline"
                      disabled={busy || last}
                      accessibilityLabel={t('workspace.teamspaces.changeRoleFor', { name: label })}
                      onPress={() =>
                        mutation.mutate({
                          action: 'member',
                          id: teamspace.id,
                          userId: member.userId,
                          role: member.role === 'owner' ? 'member' : 'owner',
                        })
                      }
                    >
                      <Text>
                        {t(
                          member.role === 'owner'
                            ? 'workspace.teamspaces.makeMember'
                            : 'workspace.teamspaces.makeOwner',
                        )}
                      </Text>
                    </Button>
                    {!teamspace.isDefault ? (
                      <Button
                        variant="ghost"
                        disabled={busy || last}
                        accessibilityLabel={t('workspace.teamspaces.removeName', { name: label })}
                        onPress={() =>
                          mutation.mutate(
                            { action: 'remove', id: teamspace.id, userId: member.userId },
                            { onSuccess: member.userId === user?.id ? onClose : undefined },
                          )
                        }
                      >
                        <Text>{t('workspace.teamspaces.remove')}</Text>
                      </Button>
                    ) : null}
                  </View>
                ) : null}
              </View>
            );
          })}
          {manages ? (
            <View className="gap-2">
              <Text className="font-medium">{t('workspace.teamspaces.addMember')}</Text>
              <Input
                accessibilityLabel={t('workspace.teamspaces.findMember')}
                placeholder={t('workspace.teamspaces.findMember')}
                value={memberSearch}
                onChangeText={setMemberSearch}
              />
              {workspaceMembers.isPending ? <Text>{t('common.loading')}</Text> : null}
              {workspaceMembers.isError ? (
                <Text accessibilityRole="alert">
                  {apiErrorMessage(workspaceMembers.error, t('workspace.teamspaces.failed'))}
                </Text>
              ) : null}
              {workspaceMembers.data
                ?.filter(
                  (m) =>
                    !members.data?.some((existing) => existing.userId === m.userId) &&
                    memberName(m.userId)
                      .toLocaleLowerCase()
                      .includes(memberSearch.toLocaleLowerCase()),
                )
                .map((m) => (
                  <Button
                    key={m.userId}
                    variant="outline"
                    disabled={busy || !members.data}
                    accessibilityLabel={t('workspace.teamspaces.addName', {
                      name: memberName(m.userId),
                    })}
                    onPress={() =>
                      mutation.mutate({
                        action: 'member',
                        id: teamspace.id,
                        userId: m.userId,
                        role: 'member',
                      })
                    }
                  >
                    <Text>{t('workspace.teamspaces.addName', { name: memberName(m.userId) })}</Text>
                  </Button>
                ))}
            </View>
          ) : null}
          {lastOwner ? (
            <Text className="text-sm text-muted-foreground">
              {t('workspace.teamspaces.lastOwner')}
            </Text>
          ) : null}
          {teamspace.role && !teamspace.isDefault ? (
            <Button
              variant="outline"
              disabled={busy || Boolean(lastOwner) || !members.data}
              accessibilityLabel={t('workspace.teamspaces.leave')}
              onPress={() => {
                if (user)
                  mutation.mutate(
                    { action: 'remove', id: teamspace.id, userId: user.id },
                    { onSuccess: onClose },
                  );
              }}
            >
              <Text>{t('workspace.teamspaces.leave')}</Text>
            </Button>
          ) : null}
          {manages && !teamspace.isDefault ? (
            <>
              {archiveConfirm ? <Text>{t('workspace.teamspaces.archiveInfo')}</Text> : null}
              <Button
                variant="destructive"
                disabled={busy}
                accessibilityLabel={t(
                  archiveConfirm
                    ? 'workspace.teamspaces.confirmArchive'
                    : 'workspace.teamspaces.archive',
                )}
                onPress={() =>
                  archiveConfirm
                    ? mutation.mutate(
                        { action: 'update', id: teamspace.id, input: { archived: true } },
                        { onSuccess: onClose },
                      )
                    : setArchiveConfirm(true)
                }
              >
                <Text>
                  {t(
                    archiveConfirm
                      ? 'workspace.teamspaces.confirmArchive'
                      : 'workspace.teamspaces.archive',
                  )}
                </Text>
              </Button>
            </>
          ) : null}
        </>
      ) : null}
      {mutation.isError ? (
        <Text accessibilityRole="alert" className="text-sm text-destructive">
          {apiErrorMessage(mutation.error, t('workspace.teamspaces.failed'))}
        </Text>
      ) : null}
    </View>
  );
}
