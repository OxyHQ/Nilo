import React from 'react';
import { View } from 'react-native';
import { Button } from '@oxy.so/bloom/button';
import { Dialog, type DialogControlProps } from '@oxy.so/bloom/dialog';
import { TextFieldInput, TextFieldLabel } from '@oxy.so/bloom/text-field';
import { Text } from '@oxy.so/bloom/typography';
import { useCreateWorkspace, type Workspace } from '@/lib/hooks/use-workspaces';
import { toast } from '@oxy.so/bloom/toast';
import { useTranslation } from '@/hooks/useTranslation';

/**
 * Curated set of safe, cross-platform emoji glyphs for the icon picker.
 * Kept small intentionally — the field accepts any emoji typed manually,
 * the grid is just convenience.
 */
const EMOJI_OPTIONS = [
  '🚀',
  '📚',
  '💡',
  '🎯',
  '🌱',
  '🎨',
  '🧠',
  '💼',
  '📦',
  '🛠️',
  '🪐',
  '✨',
  '🔥',
  '🌊',
  '🌍',
  '📝',
];

interface CreateWorkspaceModalProps {
  /** The caller opens the dialog; it closes itself on cancel and on success. */
  control: DialogControlProps;
  /** Called with the freshly-created workspace on success. */
  onCreated?: (workspace: Workspace) => void;
}

export function CreateWorkspaceModal({ control, onCreated }: CreateWorkspaceModalProps) {
  const { t } = useTranslation();
  const [name, setName] = React.useState('');
  const [icon, setIcon] = React.useState<string>(EMOJI_OPTIONS[0] ?? '');
  const { mutate, isPending } = useCreateWorkspace();

  // Reset form whenever the modal is dismissed.
  const handleClosed = React.useCallback(() => {
    setName('');
    setIcon(EMOJI_OPTIONS[0] ?? '');
  }, []);

  const trimmed = name.trim();
  const canSubmit = trimmed.length > 0 && !isPending;

  const handleSubmit = React.useCallback(() => {
    if (!canSubmit) return;
    mutate(
      { name: trimmed, icon: icon || null },
      {
        onSuccess: (workspace) => {
          toast.success(t('workspace.create.created', { name: workspace.name }));
          control.close();
          onCreated?.(workspace);
        },
        onError: (error) => {
          const message =
            error instanceof Error && error.message ? error.message : t('workspace.create.failed');
          toast.error(message);
        },
      },
    );
  }, [canSubmit, mutate, trimmed, icon, control, onCreated, t]);

  return (
    <Dialog
      control={control}
      onClose={handleClosed}
      placement={{ base: 'bottom', md: 'center' }}
      title={t('workspace.create.title')}
      description={t('workspace.create.description')}
    >
      <View className="gap-3">
        <View>
          <TextFieldLabel>{t('common.name')}</TextFieldLabel>
          <TextFieldInput
            label={t('common.name')}
            value={name}
            onChangeText={setName}
            placeholder={t('workspace.create.namePlaceholder')}
            autoCapitalize="words"
            autoFocus
            maxLength={80}
            onSubmitEditing={handleSubmit}
            returnKeyType="done"
          />
        </View>

        <View className="gap-1.5">
          <Text variant="body-medium">{t('workspace.create.icon')}</Text>
          <View className="flex-row flex-wrap gap-1.5">
            {EMOJI_OPTIONS.map((emoji) => (
              <Button
                key={emoji}
                appearance="outline"
                iconOnly
                pressed={emoji === icon}
                onPress={() => setIcon(emoji)}
                accessibilityLabel={t('workspace.create.useIcon', { emoji })}
                icon={
                  <Text className="text-lg text-foreground" style={{ lineHeight: 22 }}>
                    {emoji}
                  </Text>
                }
              />
            ))}
          </View>
        </View>
      </View>

      {/* Not Dialog `actions`: a declarative action cannot show the submit's spinner. */}
      <View className="mt-5 flex-row justify-end gap-2">
        <Button appearance="outline" onPress={() => control.close()} disabled={isPending}>
          {t('common.cancel')}
        </Button>
        <Button
          appearance="solid"
          tone="accent"
          onPress={handleSubmit}
          disabled={!canSubmit}
          loading={isPending}
        >
          {t('workspace.create.submit')}
        </Button>
      </View>
    </Dialog>
  );
}
