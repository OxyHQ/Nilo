import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Dialog, useDialogControl } from '@oxy.so/bloom/dialog';
import { Item } from '@oxy.so/bloom/item';
import { Loading } from '@oxy.so/bloom/loading';
import { TextFieldInput } from '@oxy.so/bloom/text-field';
import { Text } from '@oxy.so/bloom/typography';
import { useTranslation } from '@/hooks/useTranslation';
import { useUpdatePage } from '@/lib/hooks/use-pages';
import { canAddToTeamspace, useTeamspaces } from '@/lib/hooks/use-teamspaces';
import { useWorkspaceRole } from '@/lib/hooks/use-workspaces';
import { apiErrorMessage } from '@/lib/api/error-message';
import type { Page } from '@/lib/types/pages';

interface MoveToDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  page: Page;
}
export function MoveToDialog(props: MoveToDialogProps) {
  if (!props.open) return null;
  return <MoveDestinations {...props} />;
}
function MoveDestinations({ onOpenChange, page }: MoveToDialogProps) {
  const { t } = useTranslation();
  const control = useDialogControl();
  const [query, setQuery] = useState('');
  const spaces = useTeamspaces(page.workspaceId);
  const role = useWorkspaceRole(page.workspaceId);
  const update = useUpdatePage();
  const move = (teamspaceId: string | null) =>
    update.mutate(
      { id: page.id, parentId: null, teamspaceId },
      { onSuccess: () => control.close() },
    );
  const error = update.error ?? spaces.error;
  return (
    <Dialog
      control={control}
      startOpen
      onClose={() => onOpenChange(false)}
      dismissOnBackdrop={!update.isPending}
      placement={{ base: 'bottom', md: 'center' }}
      maxWidth={448}
      label={t('pages.moveDialog.title')}
      title={t('pages.moveDialog.title')}
      actions={[
        {
          label: t('common.close'),
          color: 'cancel',
          disabled: update.isPending,
        },
      ]}
    >
      <View className="gap-3">
        <TextFieldInput
          label={t('workspace.teamspaces.search')}
          placeholder={t('workspace.teamspaces.search')}
          value={query}
          onChangeText={setQuery}
        />
        <ScrollView className="max-h-80">
          {role ? (
            <Item
              title={t('sidebar.sections.private')}
              density="compact"
              disabled={update.isPending}
              accessibilityLabel={t('sidebar.sections.private')}
              onPress={() => move(null)}
            />
          ) : null}
          {spaces.isPending ? <Loading variant="inline" text={t('common.loading')} /> : null}
          {spaces.data
            ?.filter(
              (space) =>
                canAddToTeamspace(space, role) &&
                space.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
            )
            .map((space) => (
              <Item
                key={space.id}
                title={space.icon ? `${space.icon} ${space.name}` : space.name}
                density="compact"
                disabled={update.isPending}
                accessibilityLabel={space.name}
                onPress={() => move(space.id)}
              />
            ))}
        </ScrollView>
        {error ? (
          <Text accessibilityRole="alert" className="text-sm text-destructive">
            {apiErrorMessage(error, t('workspace.teamspaces.failed'))}
          </Text>
        ) : null}
      </View>
    </Dialog>
  );
}
