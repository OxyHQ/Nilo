import { usePathname, useRouter } from 'expo-router';
import { useDeleteDatabase, useDatabase, useUpdateDatabase } from '@/lib/hooks/use-databases';
import { useAddProperty, useDeleteProperty } from '@/lib/hooks/use-database-properties';
import { subItemProperties } from '@/lib/sub-items';
import { RiMoreLine } from '@oxy.so/bloom/icons/RiMoreLine';
import { Button } from '@oxy.so/bloom/button';
import { useDialogControl } from '@oxy.so/bloom/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@oxy.so/bloom/dropdown-menu';
import { confirm } from '@oxy.so/bloom/surfaces';
import { toast } from '@oxy.so/bloom/toast';
import { useTranslation } from '@/hooks/useTranslation';
import { databaseChangeError } from '@/lib/database-errors';
import { useExportDatabase } from '@/lib/hooks/use-page-transfer';
import { saveExport } from '@/lib/save-export';
import { DatabaseChromePickers } from './database-chrome';

/**
 * The database's menu: sub-items, locking, its icon and cover, the trash and
 * deleting it for good (its owner's), and exporting it. A reader's
 * (`readOnly`) only exports it. An app's database (`systemKey`) is never
 * trashed or deleted.
 */
export function DatabaseActionsMenu({
  databaseId,
  readOnly = false,
}: {
  databaseId: string;
  readOnly?: boolean;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const exportCsv = useExportDatabase();
  const { data } = useDatabase(databaseId);
  const add = useAddProperty();
  const remove = useDeleteProperty();
  const updateDatabase = useUpdateDatabase();
  const deleteDatabase = useDeleteDatabase();
  const iconPicker = useDialogControl();
  const coverPicker = useDialogControl();
  const database = data?.database;
  const subItems = database ? subItemProperties(database) : null;
  const locked = database?.locked ?? false;
  const toggleSubItems = async () => {
    try {
      if (subItems) await remove.mutateAsync({ databaseId, propertyId: subItems.children.id });
      else
        await add.mutateAsync({
          databaseId,
          name: t('databases.subItems.name'),
          type: 'relation',
          config: { targetDatabaseId: databaseId, twoWay: true },
        });
    } catch {
      toast.error(t('databases.relations.failed'));
    }
  };
  const disableSubItems = async () => {
    const confirmed = await confirm({
      title: t('databases.subItems.disable'),
      description: t('databases.subItems.removeDescription'),
      confirmLabel: t('common.confirm'),
      cancelLabel: t('common.cancel'),
      destructive: true,
    });
    if (confirmed) await toggleSubItems();
  };
  const download = async () => {
    try {
      await saveExport(
        await exportCsv.mutateAsync({ id: databaseId, fallback: t('databases.untitledDatabase') }),
      );
      toast.success(t('pages.export.downloaded'));
    } catch {
      toast.error(t('pages.toasts.exportFailed'));
    }
  };
  const toggleLock = () =>
    updateDatabase.mutate(
      { id: databaseId, locked: !locked },
      {
        onSuccess: () =>
          toast.success(t(locked ? 'databases.lock.unlocked' : 'databases.lock.locked')),
        onError: () => toast.error(t('databases.lock.failed')),
      },
    );
  // Its page shown no more once it is gone: back to the workspace.
  const leave = () => {
    if (pathname === `/db/${databaseId}`) router.replace('/(app)');
  };
  const trash = async (hard: boolean) => {
    if (!database) return;
    const name = database.name.trim() || t('databases.untitledDatabase');
    const confirmed = await confirm({
      title: t(hard ? 'databases.delete.hardTitle' : 'databases.delete.trashTitle'),
      description: t(
        hard ? 'databases.delete.hardDescription' : 'databases.delete.trashDescription',
        { name },
      ),
      confirmLabel: t(hard ? 'common.delete' : 'databases.delete.trash'),
      cancelLabel: t('common.cancel'),
      destructive: true,
    });
    if (!confirmed) return;
    try {
      await deleteDatabase.mutateAsync({ id: databaseId, workspaceId: database.workspaceId, hard });
      toast.success(t(hard ? 'databases.delete.deleted' : 'databases.delete.trashed'));
      leave();
    } catch (error) {
      toast.error(databaseChangeError(error, database, t('databases.delete.failed')));
    }
  };
  const editable = !readOnly && Boolean(database);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            iconOnly
            appearance="plain"
            accessibilityLabel={t('databases.csv.menu')}
            leadingIcon={RiMoreLine}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" label={t('databases.csv.menu')}>
          {!readOnly ? (
            <DropdownMenuItem
              // A sub-items relation is a property: not on a locked database.
              disabled={!data || locked || add.isPending || remove.isPending}
              onPress={() => void (subItems ? disableSubItems() : toggleSubItems())}
            >
              {t(subItems ? 'databases.subItems.disable' : 'databases.subItems.name')}
            </DropdownMenuItem>
          ) : null}
          {editable ? (
            <>
              <DropdownMenuItem disabled={updateDatabase.isPending} onPress={toggleLock}>
                {t(locked ? 'databases.lock.unlock' : 'databases.lock.lock')}
              </DropdownMenuItem>
              <DropdownMenuItem onPress={() => iconPicker.open()}>
                {t('databases.chrome.changeIcon')}
              </DropdownMenuItem>
              <DropdownMenuItem onPress={() => coverPicker.open()}>
                {t(database?.cover ? 'databases.chrome.changeCover' : 'databases.chrome.addCover')}
              </DropdownMenuItem>
              {database?.cover ? (
                <DropdownMenuItem
                  onPress={() => updateDatabase.mutate({ id: databaseId, cover: null })}
                >
                  {t('databases.chrome.removeCover')}
                </DropdownMenuItem>
              ) : null}
            </>
          ) : null}
          <DropdownMenuItem disabled={exportCsv.isPending} onPress={() => void download()}>
            {t('databases.csv.export')}
          </DropdownMenuItem>
          {editable && !database?.systemKey ? (
            <DropdownMenuItem
              variant="destructive"
              disabled={deleteDatabase.isPending}
              onPress={() => void trash(false)}
            >
              {t('databases.delete.trash')}
            </DropdownMenuItem>
          ) : null}
          {editable && !database?.systemKey && data?.role === 'owner' ? (
            <DropdownMenuItem
              variant="destructive"
              disabled={deleteDatabase.isPending}
              onPress={() => void trash(true)}
            >
              {t('databases.delete.hard')}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {editable ? (
        <DatabaseChromePickers
          databaseId={databaseId}
          iconControl={iconPicker}
          coverControl={coverPicker}
        />
      ) : null}
    </>
  );
}
