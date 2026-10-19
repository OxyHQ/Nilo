import { toast } from '@oxy.so/bloom/toast';
import { DatabaseActionsMenu } from './database-actions-menu';
import * as React from 'react';
import { Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { RiArrowLeftSLine } from '@oxy.so/bloom/icons/RiArrowLeftSLine';
import { RiArrowRightSLine } from '@oxy.so/bloom/icons/RiArrowRightSLine';
import { RiCalendarLine } from '@oxy.so/bloom/icons/RiCalendarLine';
import { RiLockLine } from '@oxy.so/bloom/icons/RiLockLine';
import { RiSettings3Line } from '@oxy.so/bloom/icons/RiSettings3Line';
import { RiStarLine } from '@oxy.so/bloom/icons/RiStarLine';
import { RiFileList3Line } from '@oxy.so/bloom/icons/RiFileList3Line';
import { RiGalleryView } from '@oxy.so/bloom/icons/RiGalleryView';
import { RiKanbanView2 } from '@oxy.so/bloom/icons/RiKanbanView2';
import { RiListUnordered } from '@oxy.so/bloom/icons/RiListUnordered';
import { RiAddLine } from '@oxy.so/bloom/icons/RiAddLine';
import { RiEqualizerLine } from '@oxy.so/bloom/icons/RiEqualizerLine';
import { RiTableLine } from '@oxy.so/bloom/icons/RiTableLine';
import { RiHistoryLine } from '@oxy.so/bloom/icons/RiHistoryLine';
import { Button } from '@oxy.so/bloom/button';
import { Dialog, useDialogControl } from '@oxy.so/bloom/dialog';
import { Item } from '@oxy.so/bloom/item';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@oxy.so/bloom/popover';
import { Tabs, TabsTrigger } from '@oxy.so/bloom/tabs';
import { TextFieldInput } from '@oxy.so/bloom/text-field';
import { useTranslation } from '@/hooks/useTranslation';
import i18n from '@/lib/i18n';
import { useColorScheme } from '@/lib/useColorScheme';
import type { Database, DatabaseView, DatabaseViewType } from '@/lib/types/databases';
import { useDatabase, useUpdateDatabase } from '@/lib/hooks/use-databases';
import {
  useCreateView,
  useDatabaseViews,
  useDeleteView,
  useUpdateView,
} from '@/lib/hooks/use-database-views';
import { hasRole } from '@/lib/hooks/workspace-roles';
import { movedViews, orderChanges } from '@/lib/view-order';
import type { BloomIconComponent } from '@oxy.so/bloom/icons';
import { CoverDisplay } from '@/components/page-chrome/cover-display';
import { IconDisplay } from '@/components/page-chrome/icon-display';
import { DatabaseChromePickers } from './database-chrome';
import { ViewSettings } from './view-settings';

const VIEW_ICONS: Record<DatabaseViewType, BloomIconComponent> = {
  form: RiFileList3Line,
  table: RiTableLine,
  board: RiKanbanView2,
  gallery: RiGalleryView,
  list: RiListUnordered,
  calendar: RiCalendarLine,
  timeline: RiHistoryLine,
};

/** Translated at call time: the locale can change while the app runs. */
function viewTypeLabel(type: DatabaseViewType): string {
  switch (type) {
    case 'form':
      return i18n.t('databases.views.form');
    case 'table':
      return i18n.t('databases.views.table');
    case 'board':
      return i18n.t('databases.views.board');
    case 'gallery':
      return i18n.t('databases.views.gallery');
    case 'list':
      return i18n.t('databases.views.list');
    case 'calendar':
      return i18n.t('databases.views.calendar');
    case 'timeline':
      return i18n.t('databases.views.timeline');
  }
}

interface DatabaseHeaderProps {
  database: Database;
  views: DatabaseView[];
  activeViewId: string | null;
  onSelectView: (id: string) => void;
  /** A reader's: the title, the views and the database's settings are shown, not edited. */
  readOnly?: boolean;
}

export function DatabaseHeader({
  database,
  views,
  activeViewId,
  onSelectView,
  readOnly = false,
}: DatabaseHeaderProps) {
  const { colors } = useColorScheme();
  const { t } = useTranslation();
  const updateDatabase = useUpdateDatabase();
  const createView = useCreateView();
  const [titleDraft, setTitleDraft] = React.useState<string | null>(null);
  const [newViewOpen, setNewViewOpen] = React.useState(false);
  const iconPicker = useDialogControl();
  const coverPicker = useDialogControl();
  const locked = database.locked === true;

  const handleTitleBlur = () => {
    if (readOnly || titleDraft === null) return;
    if (titleDraft === database.name) {
      setTitleDraft(null);
      return;
    }
    updateDatabase.mutate({ id: database.id, name: titleDraft });
    setTitleDraft(null);
  };

  const handleAddView = async (type: DatabaseViewType) => {
    if (createView.isPending) return;
    try {
      const created = await createView.mutateAsync({
        databaseId: database.id,
        name: viewTypeLabel(type),
        type,
      });
      setNewViewOpen(false);
      onSelectView(created.id);
    } catch {
      toast.error(t('databases.views.createFailed'));
    }
  };

  return (
    <View className="border-b border-border/30">
      {database.cover ? (
        <Pressable
          disabled={readOnly}
          accessibilityRole={readOnly ? undefined : 'button'}
          accessibilityLabel={t('databases.chrome.changeCover')}
          onPress={() => coverPicker.open()}
        >
          <CoverDisplay value={database.cover} height={160} />
        </Pressable>
      ) : null}
      <View className="px-6 py-4 gap-3">
        <View className="flex-row items-center gap-2">
          <Pressable
            disabled={readOnly}
            accessibilityRole={readOnly ? undefined : 'button'}
            accessibilityLabel={t('databases.chrome.changeIcon')}
            onPress={() => iconPicker.open()}
          >
            {database.icon ? (
              <IconDisplay value={database.icon} size={36} />
            ) : (
              <RiTableLine size="xl" fill={colors.foreground} />
            )}
          </Pressable>
          <View className="flex-1">
            <TextInput
              value={titleDraft ?? database.name}
              onChangeText={setTitleDraft}
              onBlur={handleTitleBlur}
              editable={!readOnly}
              placeholder={t('databases.untitledDatabase')}
              placeholderTextColor={colors.mutedForeground}
              className="text-3xl font-bold text-foreground"
              style={
                Platform.OS === 'web' ? { outlineWidth: 0, borderWidth: 0, padding: 0 } : undefined
              }
              underlineColorAndroid="transparent"
            />
          </View>
          {locked ? (
            <Button
              appearance="subtle"
              size="xs"
              leadingIcon={RiLockLine}
              disabled={readOnly || updateDatabase.isPending}
              accessibilityLabel={t(readOnly ? 'databases.lock.badge' : 'databases.lock.unlock')}
              onPress={() => updateDatabase.mutate({ id: database.id, locked: false })}
            >
              {t('databases.lock.badge')}
            </Button>
          ) : null}
          <DatabaseActionsMenu databaseId={database.id} readOnly={readOnly} />
        </View>

        {/* View tabs */}
        <View className="flex-row items-center gap-1">
          <View className="flex-shrink">
            <Tabs
              value={activeViewId ?? undefined}
              onValueChange={onSelectView}
              variant="pill"
              label={t('databases.views.title')}
            >
              {views.map((v) => (
                <ViewTab key={v.id} view={v} database={database} readOnly={readOnly} />
              ))}
            </Tabs>
          </View>
          {/* A locked database's views are as they are. */}
          {!readOnly && !locked ? (
            <Button
              appearance="plain"
              size="xs"
              onPress={() => setNewViewOpen(true)}
              leadingIcon={RiAddLine}
            >
              {t('databases.views.new')}
            </Button>
          ) : null}
        </View>
      </View>
      <NewViewPicker
        open={!readOnly && !locked && newViewOpen}
        onClose={() => setNewViewOpen(false)}
        onChoose={handleAddView}
        pending={createView.isPending}
      />
      {!readOnly ? (
        <DatabaseChromePickers
          databaseId={database.id}
          iconControl={iconPicker}
          coverControl={coverPicker}
        />
      ) : null}
    </View>
  );
}

interface ViewTabProps {
  readOnly?: boolean;
  view: DatabaseView;
  database: Database;
}

/** What a dragged view tab carries (web): its view's id, and only to its siblings. */
const VIEW_DRAG_TYPE = 'application/x-nilo-view';

/**
 * One view in a database's `Tabs` strip, with its menu beside the label:
 * rename, settings (`ViewSettings`), make it the default, move it left or
 * right (or drag it, on web), delete it. A locked database's own views have
 * none.
 */
export function ViewTab({ view, database, readOnly = false }: ViewTabProps) {
  const { t } = useTranslation();
  const { colors } = useColorScheme();
  const Icon = VIEW_ICONS[view.type] ?? RiTableLine;
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [mode, setMode] = React.useState<'menu' | 'rename' | 'settings'>('menu');
  const updateView = useUpdateView();
  const deleteView = useDeleteView();
  const [renameDraft, setRenameDraft] = React.useState('');
  const detail = useDatabase(database.id);
  const linkedViews = useDatabaseViews(
    database.id,
    view.blockId ?? undefined,
    Boolean(view.blockId),
  );
  // Its siblings: the database's own views, or its linked block's.
  const siblings = React.useMemo(
    () =>
      [...((view.blockId ? linkedViews.data?.views : detail.data?.views) ?? [view])].sort(
        (a, b) => a.order - b.order,
      ),
    [view, linkedViews.data?.views, detail.data?.views],
  );
  const editable = !readOnly && !(database.locked && !view.blockId);
  const canEditSchema = hasRole(detail.data?.role, 'editor') && !database.locked;
  const index = siblings.findIndex((v) => v.id === view.id);

  const close = () => {
    setMenuOpen(false);
    setMode('menu');
  };

  const commitRename = async () => {
    if (!editable || renameDraft.trim() === view.name) return close();
    try {
      await updateView.mutateAsync({
        databaseId: database.id,
        viewId: view.id,
        name: renameDraft.trim(),
      });
      close();
    } catch {
      toast.error(t('databases.views.updateFailed'));
    }
  };

  // A move writes the orders that change (`lib/view-order.ts`).
  const moveTo = React.useCallback(
    async (id: string, to: number) => {
      try {
        await Promise.all(
          orderChanges(movedViews(siblings, id, to)).map((change) =>
            updateView.mutateAsync({ databaseId: database.id, ...change }),
          ),
        );
      } catch {
        toast.error(t('databases.views.updateFailed'));
      }
    },
    [siblings, updateView, database.id, t],
  );

  const makeDefault = async () => {
    try {
      await updateView.mutateAsync({ databaseId: database.id, viewId: view.id, isDefault: true });
      close();
    } catch {
      toast.error(t('databases.views.updateFailed'));
    }
  };

  // Web: the tab itself is dragged onto another. It is found by its test id
  // because the trigger is Bloom's and the strip measures it, so it cannot be
  // wrapped in an element of ours.
  const testID = `database-view-tab-${view.id}`;
  React.useEffect(() => {
    if (Platform.OS !== 'web' || !editable || typeof document === 'undefined') return;
    const element = document.querySelector<HTMLElement>(`[data-testid="${testID}"]`);
    if (!element) return;
    const start = (event: DragEvent) => {
      event.dataTransfer?.setData(VIEW_DRAG_TYPE, view.id);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    };
    const over = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes(VIEW_DRAG_TYPE)) event.preventDefault();
    };
    const drop = (event: DragEvent) => {
      const dragged = event.dataTransfer?.getData(VIEW_DRAG_TYPE);
      if (!dragged || dragged === view.id || !siblings.some((v) => v.id === dragged)) return;
      event.preventDefault();
      void moveTo(dragged, index);
    };
    element.draggable = true;
    element.addEventListener('dragstart', start);
    element.addEventListener('dragover', over);
    element.addEventListener('drop', drop);
    return () => {
      element.draggable = false;
      element.removeEventListener('dragstart', start);
      element.removeEventListener('dragover', over);
      element.removeEventListener('drop', drop);
    };
  }, [editable, testID, view.id, siblings, index, moveTo]);

  // The settings button is the trigger's `trailing` node: Bloom lays it beside
  // the tab's press target, so opening the menu does not select the view.
  const settings = !editable ? undefined : (
    <Popover
      open={menuOpen}
      onOpenChange={(next) => {
        if (next) setMenuOpen(true);
        else close();
      }}
    >
      <PopoverTrigger asChild>
        <Button
          iconOnly
          appearance="plain"
          size="xs"
          accessibilityLabel={t('databases.views.settings', { name: view.name })}
          leadingIcon={RiEqualizerLine}
        />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        minWidth={mode === 'settings' ? 300 : 240}
        label={view.name}
        className="gap-2"
      >
        <PopoverTitle tone="secondary">{view.name}</PopoverTitle>
        {mode === 'menu' ? (
          <>
            <Item
              density="compact"
              accessibilityRole="button"
              title={t('databases.views.rename')}
              onPress={() => {
                setRenameDraft(view.name);
                setMode('rename');
              }}
            />
            <Item
              density="compact"
              accessibilityRole="button"
              leading={<RiSettings3Line width={14} height={14} fill={colors.foreground} />}
              title={t('databases.viewSettings.title')}
              onPress={() => setMode('settings')}
            />
            {!view.isDefault ? (
              <Item
                density="compact"
                accessibilityRole="button"
                leading={<RiStarLine width={14} height={14} fill={colors.foreground} />}
                title={t('databases.views.makeDefault')}
                disabled={updateView.isPending}
                onPress={() => void makeDefault()}
              />
            ) : null}
            <Item
              density="compact"
              accessibilityRole="button"
              leading={<RiArrowLeftSLine width={14} height={14} fill={colors.foreground} />}
              title={t('databases.views.moveLeft')}
              disabled={index <= 0 || updateView.isPending}
              onPress={() => void moveTo(view.id, index - 1)}
            />
            <Item
              density="compact"
              accessibilityRole="button"
              leading={<RiArrowRightSLine width={14} height={14} fill={colors.foreground} />}
              title={t('databases.views.moveRight')}
              disabled={index === -1 || index >= siblings.length - 1 || updateView.isPending}
              onPress={() => void moveTo(view.id, index + 1)}
            />
            <Item
              density="compact"
              accessibilityRole="button"
              destructive
              title={t('databases.views.delete')}
              disabled={deleteView.isPending}
              onPress={async () => {
                try {
                  await deleteView.mutateAsync({
                    databaseId: database.id,
                    viewId: view.id,
                    blockId: view.blockId,
                  });
                  close();
                } catch {
                  toast.error(t('databases.views.deleteFailed'));
                }
              }}
            />
          </>
        ) : null}
        {mode === 'rename' ? (
          <>
            <TextFieldInput
              size="sm"
              label={t('databases.views.namePlaceholder')}
              value={renameDraft}
              onChangeText={setRenameDraft}
              autoFocus
              onSubmitEditing={commitRename}
            />
            <View className="mt-1 flex-row justify-end gap-2">
              <Button appearance="subtle" size="sm" onPress={close}>
                {t('common.cancel')}
              </Button>
              <Button
                appearance="solid"
                tone="accent"
                size="sm"
                disabled={updateView.isPending || !renameDraft.trim()}
                onPress={commitRename}
              >
                {t('common.save')}
              </Button>
            </View>
          </>
        ) : null}
        {mode === 'settings' ? (
          <>
            <ScrollView style={{ maxHeight: 440 }} keyboardShouldPersistTaps="handled">
              <ViewSettings database={database} view={view} canEditSchema={canEditSchema} />
            </ScrollView>
            <View className="mt-1 flex-row justify-end">
              <Button appearance="subtle" size="sm" onPress={() => setMode('menu')}>
                {t('common.back')}
              </Button>
            </View>
          </>
        ) : null}
      </PopoverContent>
    </Popover>
  );

  return (
    <TabsTrigger
      value={view.id}
      label={view.name}
      leadingIcon={Icon}
      trailing={settings}
      testID={testID}
      onLongPress={!editable ? undefined : () => setMenuOpen(true)}
    />
  );
}

interface NewViewPickerProps {
  open: boolean;
  onClose: () => void;
  onChoose: (type: DatabaseViewType) => void;
  pending: boolean;
}

/**
 * The view-type picker. Its owner holds the open state, so the dialog runs in
 * its controlled mode: `onClose` is the close request the owner answers.
 */
export function NewViewPicker({ open, onClose, onChoose, pending }: NewViewPickerProps) {
  const { colors } = useColorScheme();
  const { t } = useTranslation();
  const types: DatabaseViewType[] = [
    'table',
    'board',
    'gallery',
    'list',
    'calendar',
    'timeline',
    'form',
  ];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      placement={{ base: 'bottom', md: 'center' }}
      maxWidth={320}
      title={t('databases.views.new')}
    >
      {types.map((type) => {
        const Icon = VIEW_ICONS[type];
        return (
          <Item
            key={type}
            density="compact"
            accessibilityRole="button"
            disabled={pending}
            leading={<Icon width={14} height={14} fill={colors.foreground} />}
            title={viewTypeLabel(type)}
            onPress={() => onChoose(type)}
          />
        );
      })}
    </Dialog>
  );
}
