import React from 'react';
import { View } from 'react-native';
import { Dialog, type DialogControlProps } from '@oxy.so/bloom/dialog';
import { TextFieldInput, TextFieldLabel } from '@oxy.so/bloom/text-field';
import { toast } from '@oxy.so/bloom/toast';
import { apiErrorMessage } from '@/lib/api/error-message';
import { useCreateWorkspace, WORKSPACE_NAME_MAX, type Workspace } from '@/lib/hooks/use-workspaces';
import { useTranslation } from '@/hooks/useTranslation';
import { WorkspaceAvatarPicker } from './workspace-avatar-picker';

interface CreateWorkspaceModalProps {
  /** The caller opens the dialog; it closes itself on cancel and on success. */
  control: DialogControlProps;
  /** Called with the freshly-created workspace on success. */
  onCreated?: (workspace: Workspace) => void;
}

// A Bloom dialog, not a React Native `Modal`: the file picker opens as a Bloom
// surface, which stacks above a Bloom dialog but under a native modal window.
export function CreateWorkspaceModal({ control, onCreated }: CreateWorkspaceModalProps) {
  const { t } = useTranslation();
  const [name, setName] = React.useState('');
  const [avatar, setAvatar] = React.useState<string | null>(null);
  const { mutate, isPending } = useCreateWorkspace();

  // Reset form whenever the modal is dismissed.
  const handleClosed = React.useCallback(() => {
    setName('');
    setAvatar(null);
  }, []);

  const trimmed = name.trim();
  const canSubmit = trimmed.length > 0 && !isPending;

  const handleSubmit = React.useCallback(() => {
    if (!canSubmit) return;
    mutate(
      { name: trimmed, avatar },
      {
        onSuccess: (workspace) => {
          toast.success(t('workspace.create.created', { name: workspace.name }));
          control.close();
          onCreated?.(workspace);
        },
        onError: (error) => {
          toast.error(apiErrorMessage(error, t('workspace.create.failed')));
        },
      },
    );
  }, [canSubmit, mutate, trimmed, avatar, control, onCreated, t]);

  return (
    <Dialog
      control={control}
      onClose={handleClosed}
      placement={{ base: 'bottom', md: 'center' }}
      title={t('workspace.create.title')}
      description={t('workspace.create.description')}
      actions={[
        {
          label: t('workspace.create.submit'),
          onPress: handleSubmit,
          disabled: !canSubmit && !isPending,
          loading: isPending,
          // The dialog stays up until the request settles; success closes it.
          shouldCloseOnPress: false,
        },
        { label: t('common.cancel'), color: 'cancel', disabled: isPending },
      ]}
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
      </View>
    </Dialog>
  );
}
