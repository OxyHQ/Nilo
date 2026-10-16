import { useState } from 'react';
import { View } from 'react-native';
import { useOxy } from '@oxy.so/services';
import { Button } from '@oxy.so/bloom/button';
import { Dialog, type DialogControlProps } from '@oxy.so/bloom/dialog';
import { Item } from '@oxy.so/bloom/item';
import { Loading } from '@oxy.so/bloom/loading';
import { RadioGroup } from '@oxy.so/bloom/radio';
import { TextFieldInput, TextFieldLabel } from '@oxy.so/bloom/text-field';
import { Text } from '@oxy.so/bloom/typography';
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

/** What the dialog shows: the list, the create form, or one teamspace's settings. */
export type TeamspaceSelection = 'browse' | 'create' | Teamspace;

const PRIVACIES: TeamspacePrivacy[] = ['open', 'closed', 'private'];

/**
 * Browse, create and manage teamspaces. The caller owns the dialog's `control`
 * and what it shows, so it can set `selection` and open in one press.
 */
export function TeamspaceDialog({
  control,
  workspaceId,
  selection,
  onSelect,
}: {
  control: DialogControlProps;
  workspaceId: string;
  selection: TeamspaceSelection;
  onSelect: (selection: TeamspaceSelection) => void;
}) {
  const { t } = useTranslation();
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
  const close = () => control.close();
  return (
    <Dialog
      control={control}
      placement={{ base: 'bottom', md: 'center' }}
      maxWidth={512}
      title={title}
      label={title}
      actions={[{ label: t('common.close'), color: 'cancel' }]}
    >
      {selection === 'browse' ? (
        <View className="gap-3 pb-4">
          {hasRole(role, 'editor') ? (
            <Button
              appearance="solid"
              tone="accent"
              accessibilityLabel={t('workspace.teamspaces.create')}
              onPress={() => onSelect('create')}
            >
              {t('workspace.teamspaces.create')}
            </Button>
          ) : null}
          {teamspaces.isPending ? (
            <Loading variant="inline" size="sm" text={t('common.loading')} />
          ) : null}
          {teamspaces.isError ? (
            <Text accessibilityRole="alert" className="text-sm text-destructive">
              {apiErrorMessage(teamspaces.error, t('workspace.teamspaces.failed'))}
            </Text>
          ) : null}
          {teamspaces.data
            ?.filter((space) => !space.archived)
            .map((space) => (
              <View key={space.id} className="rounded-lg border border-border">
                <Item
                  accessibilityLabel={space.name}
                  onPress={() => onSelect(space)}
                  title={`${space.icon ?? ''} ${space.name}`.trim()}
                  subtitle={t(`workspace.teamspaces.privacy.${space.privacy}`)}
                  trailing={
                    space.role ? (
                      <Text className="text-sm text-muted-foreground">
                        {t('workspace.teamspaces.joined')}
                      </Text>
                    ) : space.privacy === 'open' ? (
                      <Button
                        appearance="outline"
                        size="sm"
                        stopPropagation
                        disabled={mutation.isPending}
                        accessibilityLabel={t('workspace.teamspaces.joinName', {
                          name: space.name,
                        })}
                        onPress={() => mutation.mutate({ action: 'join', id: space.id })}
                      >
                        {t('workspace.teamspaces.join')}
                      </Button>
                    ) : undefined
                  }
                />
                {space.description ? (
                  <Text className="px-4 pb-3 text-sm text-foreground">{space.description}</Text>
                ) : null}
              </View>
            ))}
          {mutation.isError ? (
            <Text accessibilityRole="alert" className="text-sm text-destructive">
              {apiErrorMessage(mutation.error, t('workspace.teamspaces.failed'))}
            </Text>
          ) : null}
        </View>
      ) : (
        <TeamspaceDetails
          key={selected?.id ?? 'create'}
          workspaceId={workspaceId}
          teamspace={selected}
          onClose={close}
        />
      )}
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
    <View className="gap-3 pb-4">
      {(['name', 'icon', 'description'] as const).map((field) => (
        <View key={field}>
          <TextFieldLabel>{t(`workspace.teamspaces.${field}`)}</TextFieldLabel>
          <TextFieldInput
            label={t(`workspace.teamspaces.${field}`)}
            placeholder={null}
            value={field === 'name' ? name : field === 'icon' ? icon : description}
            onChangeText={field === 'name' ? setName : field === 'icon' ? setIcon : setDescription}
            maxLength={field === 'description' ? 2000 : 200}
            multiline={field === 'description'}
            editable={manages && !busy}
          />
        </View>
      ))}
      <Text variant="body-medium">{t('workspace.teamspaces.privacyLabel')}</Text>
      <RadioGroup
        label={t('workspace.teamspaces.privacyLabel')}
        value={privacy}
        onValueChange={(value) => setPrivacy(value as TeamspacePrivacy)}
        disabled={!manages || Boolean(teamspace?.isDefault) || busy}
        options={PRIVACIES.map((value) => ({
          value,
          label: t(`workspace.teamspaces.privacy.${value}`),
          description: t(`workspace.teamspaces.explanation.${value}`),
        }))}
      />
      {teamspace?.isDefault ? (
        <Text className="text-sm text-muted-foreground">
          {t('workspace.teamspaces.defaultInfo')}
        </Text>
      ) : null}
      {manages ? (
        <Button
          appearance="solid"
          tone="accent"
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
          {t(teamspace ? 'common.save' : 'workspace.teamspaces.create')}
        </Button>
      ) : null}
      {teamspace ? (
        <>
          <Text accessibilityRole="header" variant="headline-semibold">
            {t('workspace.teamspaces.members', { count: members.data?.length ?? 0 })}
          </Text>
          {members.isPending ? (
            <Loading variant="inline" size="sm" text={t('common.loading')} />
          ) : null}
          {members.isError ? (
            <Text accessibilityRole="alert" className="text-sm text-destructive">
              {apiErrorMessage(members.error, t('workspace.teamspaces.failed'))}
            </Text>
          ) : null}
          {members.data?.map((member) => {
            const last = member.role === 'owner' && owners <= 1;
            const label = memberName(member.userId);
            return (
              <View key={member.userId} className="gap-2 border-b border-border py-2">
                <Text variant="body-regular">{label}</Text>
                <Text className="text-xs text-muted-foreground">
                  {t(`workspace.teamspaces.roles.${member.role}`)}
                </Text>
                {manages ? (
                  <View className="flex-row flex-wrap gap-2">
                    <Button
                      appearance="outline"
                      size="sm"
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
                      {t(
                        member.role === 'owner'
                          ? 'workspace.teamspaces.makeMember'
                          : 'workspace.teamspaces.makeOwner',
                      )}
                    </Button>
                    {!teamspace.isDefault ? (
                      <Button
                        appearance="subtle"
                        size="sm"
                        disabled={busy || last}
                        accessibilityLabel={t('workspace.teamspaces.removeName', { name: label })}
                        onPress={() =>
                          mutation.mutate(
                            { action: 'remove', id: teamspace.id, userId: member.userId },
                            { onSuccess: member.userId === user?.id ? onClose : undefined },
                          )
                        }
                      >
                        {t('workspace.teamspaces.remove')}
                      </Button>
                    ) : null}
                  </View>
                ) : null}
              </View>
            );
          })}
          {manages ? (
            <View className="gap-2">
              <Text variant="body-medium">{t('workspace.teamspaces.addMember')}</Text>
              <TextFieldInput
                label={t('workspace.teamspaces.findMember')}
                placeholder={t('workspace.teamspaces.findMember')}
                value={memberSearch}
                onChangeText={setMemberSearch}
              />
              {workspaceMembers.isPending ? (
                <Loading variant="inline" size="sm" text={t('common.loading')} />
              ) : null}
              {workspaceMembers.isError ? (
                <Text accessibilityRole="alert" className="text-sm text-destructive">
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
                    appearance="outline"
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
                    {t('workspace.teamspaces.addName', { name: memberName(m.userId) })}
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
              appearance="outline"
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
              {t('workspace.teamspaces.leave')}
            </Button>
          ) : null}
          {manages && !teamspace.isDefault ? (
            <>
              {archiveConfirm ? (
                <Text variant="body-regular">{t('workspace.teamspaces.archiveInfo')}</Text>
              ) : null}
              <Button
                appearance="solid"
                tone="danger"
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
                {t(
                  archiveConfirm
                    ? 'workspace.teamspaces.confirmArchive'
                    : 'workspace.teamspaces.archive',
                )}
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
