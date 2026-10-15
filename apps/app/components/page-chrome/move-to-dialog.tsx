import { useState } from 'react';
import { ScrollView } from 'react-native';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Text } from '@/components/ui/text';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  const [query, setQuery] = useState('');
  const spaces = useTeamspaces(page.workspaceId);
  const role = useWorkspaceRole(page.workspaceId);
  const update = useUpdatePage();
  const move = (teamspaceId: string | null) =>
    update.mutate(
      { id: page.id, parentId: null, teamspaceId },
      { onSuccess: () => onOpenChange(false) },
    );
  const error = update.error ?? spaces.error;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!update.isPending) onOpenChange(open);
      }}
    >
      <DialogContent
        accessibilityLabel={t('pages.moveDialog.title')}
        className="max-w-md gap-3 p-4"
        showCloseButton={false}
      >
        <DialogTitle>{t('pages.moveDialog.title')}</DialogTitle>
        <Input
          accessibilityLabel={t('workspace.teamspaces.search')}
          placeholder={t('workspace.teamspaces.search')}
          value={query}
          onChangeText={setQuery}
        />
        <ScrollView className="max-h-80">
          {role ? (
            <Button
              variant="ghost"
              disabled={update.isPending}
              accessibilityLabel={t('sidebar.sections.private')}
              onPress={() => move(null)}
            >
              <Text>{t('sidebar.sections.private')}</Text>
            </Button>
          ) : null}
          {spaces.isPending ? <Text>{t('common.loading')}</Text> : null}
          {spaces.data
            ?.filter(
              (space) =>
                canAddToTeamspace(space, role) &&
                space.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
            )
            .map((space) => (
              <Button
                key={space.id}
                variant="ghost"
                disabled={update.isPending}
                accessibilityLabel={space.name}
                onPress={() => move(space.id)}
              >
                <Text>
                  {space.icon} {space.name}
                </Text>
              </Button>
            ))}
        </ScrollView>
        {error ? (
          <Text accessibilityRole="alert" className="text-sm text-destructive">
            {apiErrorMessage(error, t('workspace.teamspaces.failed'))}
          </Text>
        ) : null}
        <Button
          variant="outline"
          disabled={update.isPending}
          accessibilityLabel={t('common.close')}
          onPress={() => onOpenChange(false)}
        >
          <Text>{t('common.close')}</Text>
        </Button>
      </DialogContent>
    </Dialog>
  );
}
