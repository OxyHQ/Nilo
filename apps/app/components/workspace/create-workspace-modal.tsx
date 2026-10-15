import React from 'react';
import { View, Pressable } from 'react-native';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
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
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the freshly-created workspace on success. */
  onCreated?: (workspace: Workspace) => void;
}

export function CreateWorkspaceModal({ open, onOpenChange, onCreated }: CreateWorkspaceModalProps) {
  const { t } = useTranslation();
  const [name, setName] = React.useState('');
  const [icon, setIcon] = React.useState<string>(EMOJI_OPTIONS[0] ?? '');
  const { mutate, isPending } = useCreateWorkspace();

  // Reset form whenever the modal is dismissed.
  React.useEffect(() => {
    if (!open) {
      setName('');
      setIcon(EMOJI_OPTIONS[0] ?? '');
    }
  }, [open]);

  const trimmed = name.trim();
  const canSubmit = trimmed.length > 0 && !isPending;

  const handleSubmit = React.useCallback(() => {
    if (!canSubmit) return;
    mutate(
      { name: trimmed, icon: icon || null },
      {
        onSuccess: (workspace) => {
          toast.success(t('workspace.create.created', { name: workspace.name }));
          onCreated?.(workspace);
        },
        onError: (error) => {
          const message =
            error instanceof Error && error.message ? error.message : t('workspace.create.failed');
          toast.error(message);
        },
      },
    );
  }, [canSubmit, mutate, trimmed, icon, onCreated]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('workspace.create.title')}</DialogTitle>
          <DialogDescription>{t('workspace.create.description')}</DialogDescription>
        </DialogHeader>

        <View className="gap-3">
          <View className="gap-1.5">
            <Text className="text-sm font-medium text-foreground">{t('common.name')}</Text>
            <Input
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
            <Text className="text-sm font-medium text-foreground">
              {t('workspace.create.icon')}
            </Text>
            <View className="flex-row flex-wrap gap-1.5">
              {EMOJI_OPTIONS.map((emoji) => {
                const selected = emoji === icon;
                return (
                  <Pressable
                    key={emoji}
                    onPress={() => setIcon(emoji)}
                    className={`h-9 w-9 items-center justify-center rounded-lg border ${
                      selected
                        ? 'border-primary bg-primary/10'
                        : 'border-border bg-background hover:bg-muted'
                    }`}
                    accessibilityRole="button"
                    accessibilityLabel={t('workspace.create.useIcon', { emoji })}
                  >
                    <Text className="text-lg" style={{ lineHeight: 22 }}>
                      {emoji}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>

        <DialogFooter>
          <Button variant="outline" onPress={() => onOpenChange(false)} disabled={isPending}>
            <Text>{t('common.cancel')}</Text>
          </Button>
          <Button onPress={handleSubmit} disabled={!canSubmit} isLoading={isPending}>
            <Text>{t('workspace.create.submit')}</Text>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
