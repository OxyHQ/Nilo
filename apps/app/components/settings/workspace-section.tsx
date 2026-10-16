import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '@oxy.so/bloom/button';
import {
  SettingsCard,
  SettingsRow,
  SettingsSection,
  SettingsValueField,
  useSettingsSavedToast,
} from '@oxy.so/bloom/settings-modal/modal';
import { SettingsTextField } from '@oxy.so/bloom/settings-modal/fields';
import { confirm } from '@oxy.so/bloom/surfaces';
import { toast } from '@oxy.so/bloom/toast';
import { WorkspaceAvatarPicker } from '@/components/workspace/workspace-avatar-picker';
import { useTranslation } from '@/hooks/useTranslation';
import { apiErrorMessage } from '@/lib/api/error-message';
import {
  useCurrentWorkspace,
  useDeleteWorkspace,
  useUpdateWorkspace,
  useWorkspaces,
  WORKSPACE_NAME_MAX,
  type Workspace,
} from '@/lib/hooks/use-workspaces';
import { hasRole } from '@/lib/hooks/workspace-roles';
import { useWorkspaceStore } from '@/lib/stores/workspace-store';
import { useNiloSettings } from './settings-provider';

/** The current workspace's picture and name, and what only its owner may do. */
export function WorkspaceSection() {
  const workspace = useCurrentWorkspace();
  if (!workspace) return null;
  // Keyed so switching workspaces never carries one's draft name into another.
  return <WorkspaceSettings key={workspace.id} workspace={workspace} />;
}

function WorkspaceSettings({ workspace }: { workspace: Workspace }) {
  const { t } = useTranslation();
  const showSaved = useSettingsSavedToast();
  const update = useUpdateWorkspace(workspace.id);
  const canEdit = hasRole(workspace.role, 'admin');
  // Remounts the name field, so a rejected name gives way to the saved one.
  const [nameRevision, setNameRevision] = useState(0);

  const save = (input: { name: string } | { avatar: string | null }) => {
    update.mutate(input, {
      onSuccess: showSaved,
      onError: (error) => {
        if ('name' in input) setNameRevision((n) => n + 1);
        toast.error(apiErrorMessage(error, t('settings.workspace.saveFailed')));
      },
    });
  };

  const commitName = (value: string) => {
    const name = value.trim();
    if (!name || name.length > WORKSPACE_NAME_MAX) {
      setNameRevision((n) => n + 1);
      toast.error(t('settings.workspace.nameInvalid', { max: WORKSPACE_NAME_MAX }));
      return;
    }
    // Only surrounding spaces changed: show the saved name again.
    if (name === workspace.name) setNameRevision((n) => n + 1);
    else save({ name });
  };

  return (
    <View className="gap-6">
      <SettingsSection description={canEdit ? undefined : t('settings.workspace.adminOnly')}>
        <SettingsCard>
          <SettingsRow
            label={t('workspace.avatar.label')}
            description={t('settings.workspace.avatarDescription')}
          >
            <WorkspaceAvatarPicker
              name={workspace.name}
              value={workspace.avatar}
              isPersonal={workspace.isPersonal}
              ownerId={workspace.ownerId}
              onChange={(avatar) => save({ avatar })}
              disabled={!canEdit || update.isPending}
            />
          </SettingsRow>
          <SettingsRow label={t('common.name')}>
            {canEdit ? (
              <SettingsTextField
                key={nameRevision}
                label={t('common.name')}
                value={workspace.name}
                onCommit={commitName}
                showSavedToast={false}
              />
            ) : (
              <SettingsValueField>{workspace.name}</SettingsValueField>
            )}
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
      <WorkspaceDangerZone workspace={workspace} />
    </View>
  );
}

/**
 * The irreversible actions, set apart at the bottom of the page. The section
 * shows only when the caller may take at least one of them.
 */
function WorkspaceDangerZone({ workspace }: { workspace: Workspace }) {
  const { t } = useTranslation();
  const isOwner = workspace.role === 'owner';
  const rows = [
    // A personal workspace is the member's own and cannot be deleted.
    isOwner && !workspace.isPersonal ? (
      <DeleteWorkspaceRow key="delete" workspace={workspace} />
    ) : null,
  ].filter((row) => row !== null);
  if (rows.length === 0) return null;
  return (
    <SettingsSection label={t('settings.workspace.dangerZone')}>
      <SettingsCard>{rows}</SettingsCard>
    </SettingsSection>
  );
}

function DeleteWorkspaceRow({ workspace }: { workspace: Workspace }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { afterClose } = useNiloSettings();
  const { data: workspaces } = useWorkspaces();
  const setCurrentWorkspaceId = useWorkspaceStore((s) => s.setCurrentWorkspaceId);
  const remove = useDeleteWorkspace();

  const handleDelete = async () => {
    const confirmed = await confirm({
      title: t('settings.workspace.deleteTitle', { name: workspace.name }),
      description: t('settings.workspace.deleteDescription'),
      confirmLabel: t('settings.workspace.delete'),
      destructive: true,
    });
    if (!confirmed) return;
    const personal = workspaces?.find((w) => w.isPersonal) ?? null;
    remove.mutate(workspace.id, {
      onSuccess: () => {
        toast.success(t('settings.workspace.deleted', { name: workspace.name }));
        // The open page may belong to the workspace that just went away.
        afterClose(() => {
          setCurrentWorkspaceId(personal?.id ?? null);
          router.replace('/(app)');
        });
      },
      onError: (error) => {
        toast.error(apiErrorMessage(error, t('settings.workspace.deleteFailed')));
      },
    });
  };

  return (
    <SettingsRow
      label={t('settings.workspace.delete')}
      description={t('settings.workspace.deleteDescription')}
    >
      <Button
        appearance="outline"
        tone="danger"
        size="sm"
        loading={remove.isPending}
        onPress={() => {
          void handleDelete();
        }}
      >
        {t('common.delete')}
      </Button>
    </SettingsRow>
  );
}
