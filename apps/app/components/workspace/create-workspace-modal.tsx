import React from 'react';
import { View } from 'react-native';
import { Button } from '@oxy.so/bloom/button';
import { Dialog } from '@oxy.so/bloom/dialog';
import { TextFieldInput, TextFieldLabel } from '@oxy.so/bloom/text-field';
import { toast } from '@oxy.so/bloom/toast';
import { apiErrorMessage } from '@/lib/api/error-message';
import { useCreateWorkspace, WORKSPACE_NAME_MAX, type Workspace } from '@/lib/hooks/use-workspaces';
import { useTranslation } from '@/hooks/useTranslation';
import { WorkspaceAvatarPicker } from './workspace-avatar-picker';

interface CreateWorkspaceModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the freshly-created workspace on success. */
  onCreated?: (workspace: Workspace) => void;
}

// A Bloom dialog, not a React Native `Modal`: the file picker opens as a Bloom
// surface, which stacks above a Bloom dialog but under a native modal window.
export function CreateWorkspaceModal({ open, onOpenChange, onCreated }: CreateWorkspaceModalProps) {
  const { t } = useTranslation();
  const [name, setName] = React.useState('');
  const [avatar, setAvatar] = React.useState<string | null>(null);
  const { mutate, isPending } = useCreateWorkspace();

  // Reset form whenever the modal is dismissed.
  React.useEffect(() => {
    if (!open) {
      setName('');
      setAvatar(null);
    }
  }, [open]);

  const trimmed = name.trim();
  const canSubmit = trimmed.length > 0 && !isPending;

  const handleSubmit = React.useCallback(() => {
    if (!canSubmit) return;
    mutate(
      { name: trimmed, avatar },
      {
        onSuccess: (workspace) => {
          toast.success(t('workspace.create.created', { name: workspace.name }));
          onCreated?.(workspace);
        },
        onError: (error) => {
          toast.error(apiErrorMessage(error, t('workspace.create.failed')));
        },
      },
    );
  }, [canSubmit, mutate, trimmed, avatar, onCreated, t]);

  return (
    <Dialog
      open={open}
      onClose={() => onOpenChange(false)}
      title={t('workspace.create.title')}
      description={t('workspace.create.description')}
    >
      <View className="gap-4">
        <View>
          <TextFieldLabel>{t('common.name')}</TextFieldLabel>
          <TextFieldInput
            label={t('common.name')}
            value={name}
            onChangeText={setName}
            placeholder={t('workspace.create.namePlaceholder')}
            autoCapitalize="words"
            autoFocus
            maxLength={WORKSPACE_NAME_MAX}
            onSubmitEditing={handleSubmit}
            returnKeyType="done"
          />
        </View>

        <View>
          <TextFieldLabel>{t('workspace.avatar.label')}</TextFieldLabel>
          <WorkspaceAvatarPicker
            name={trimmed || t('workspace.fallbackName')}
            value={avatar}
            onChange={setAvatar}
            disabled={isPending}
          />
        </View>

        <View className="flex-row justify-end gap-2">
          <Button
            appearance="subtle"
            tone="neutral"
            onPress={() => onOpenChange(false)}
            disabled={isPending}
          >
            {t('common.cancel')}
          </Button>
          <Button tone="action" onPress={handleSubmit} disabled={!canSubmit} loading={isPending}>
            {t('workspace.create.submit')}
          </Button>
        </View>
      </View>
    </Dialog>
  );
}
