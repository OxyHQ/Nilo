import { useCallback } from 'react';
import { View } from 'react-native';
import { Button } from '@oxy.so/bloom/button';
import type { FileMetadata } from '@oxy.so/core';
import { useOxy } from '@oxy.so/services/ui/client';
import { useTranslation } from '@/hooks/useTranslation';
import { WorkspaceAvatar } from './workspace-avatar';

interface WorkspaceAvatarPickerProps {
  /** The workspace's name, for the initial shown while it has no picture. */
  name: string;
  /** The picture's Oxy file id. */
  value: string | null;
  /** With `ownerId`, lets a personal workspace preview its owner's avatar. */
  isPersonal?: boolean;
  ownerId?: string;
  onChange: (id: string | null) => void;
  disabled?: boolean;
}

/** Picks a workspace picture from the member's Oxy files, or clears it. */
export function WorkspaceAvatarPicker({
  name,
  value,
  isPersonal,
  ownerId,
  onChange,
  disabled = false,
}: WorkspaceAvatarPickerProps) {
  const { t } = useTranslation();
  const { showBottomSheet } = useOxy();

  const pick = useCallback(() => {
    showBottomSheet?.({
      screen: 'FileManagement',
      props: {
        selectMode: true,
        multiSelect: false,
        disabledMimeTypes: ['video/', 'audio/', 'application/pdf'],
        // Every member loads the picture, so a private file would not render
        // for anyone but its owner. The picker defaults to private and would
        // otherwise demote an already public file on re-pick.
        defaultVisibility: 'public',
        afterSelect: 'back',
        onSelect: (file: FileMetadata) => {
          if (!file.contentType?.startsWith('image/')) return;
          onChange(file.id);
        },
      },
    });
  }, [showBottomSheet, onChange]);

  return (
    <View className="flex-row items-center gap-3">
      <WorkspaceAvatar workspace={{ name, avatar: value, isPersonal, ownerId }} size={48} />
      <View className="flex-row flex-wrap gap-2">
        <Button appearance="outline" tone="neutral" size="sm" disabled={disabled} onPress={pick}>
          {value ? t('workspace.avatar.change') : t('workspace.avatar.upload')}
        </Button>
        {value ? (
          <Button
            appearance="plain"
            tone="neutral"
            size="sm"
            disabled={disabled}
            onPress={() => onChange(null)}
          >
            {t('workspace.avatar.remove')}
          </Button>
        ) : null}
      </View>
    </View>
  );
}
