import { toast } from '@oxy.so/bloom/toast';
import { DatabaseActionsMenu } from './database-actions-menu';
import * as React from 'react';
import { Platform, TextInput, View } from 'react-native';
import { RiCalendarLine } from '@oxy.so/bloom/icons/RiCalendarLine';
import { RiFileList3Line } from '@oxy.so/bloom/icons/RiFileList3Line';
import { RiGalleryView } from '@oxy.so/bloom/icons/RiGalleryView';
import { RiImageLine } from '@oxy.so/bloom/icons/RiImageLine';
import { RiKanbanView2 } from '@oxy.so/bloom/icons/RiKanbanView2';
import { RiListUnordered } from '@oxy.so/bloom/icons/RiListUnordered';
import { RiAddLine } from '@oxy.so/bloom/icons/RiAddLine';
import { RiEqualizerLine } from '@oxy.so/bloom/icons/RiEqualizerLine';
import { RiTableLine } from '@oxy.so/bloom/icons/RiTableLine';
import { RiHistoryLine } from '@oxy.so/bloom/icons/RiHistoryLine';
import { Button } from '@oxy.so/bloom/button';
import { Dialog } from '@oxy.so/bloom/dialog';
import { Item } from '@oxy.so/bloom/item';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@oxy.so/bloom/popover';
import { Tabs, TabsTrigger } from '@oxy.so/bloom/tabs';
import { TextFieldInput } from '@oxy.so/bloom/text-field';
import { Text } from '@oxy.so/bloom/typography';
import { useTranslation } from '@/hooks/useTranslation';
import i18n from '@/lib/i18n';
import { useColorScheme } from '@/lib/useColorScheme';
import type { Database, DatabaseView, DatabaseViewType } from '@/lib/types/databases';
import { useUpdateDatabase } from '@/lib/hooks/use-databases';
import { useCreateView, useDeleteView, useUpdateView } from '@/lib/hooks/use-database-views';
import type { BloomIconComponent } from '@oxy.so/bloom/icons';

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
}

export function DatabaseHeader({
  database,
  views,
  activeViewId,
  onSelectView,
}: DatabaseHeaderProps) {
  const { colors } = useColorScheme();
  const { t } = useTranslation();
  const updateDatabase = useUpdateDatabase();
  const createView = useCreateView();
  const [titleDraft, setTitleDraft] = React.useState<string | null>(null);
  const [newViewOpen, setNewViewOpen] = React.useState(false);

  const handleTitleBlur = () => {
    if (titleDraft === null) return;
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
        <View className="h-32 bg-muted">
          {/* Cover image — Phase 4 keeps it visually simple. */}
          <View className="absolute inset-0 items-center justify-center">
            <RiImageLine size="xl" fill={colors.mutedForeground} />
          </View>
        </View>
      ) : null}
      <View className="px-6 py-4 gap-3">
        <View className="flex-row items-center gap-2">
          {database.icon ? (
            <Text className="text-4xl leading-none text-foreground">{database.icon}</Text>
          ) : (
            <RiTableLine size="xl" fill={colors.foreground} />
          )}
          <View className="flex-1">
            <TextInput
              value={titleDraft ?? database.name}
              onChangeText={setTitleDraft}
              onBlur={handleTitleBlur}
              placeholder={t('databases.untitledDatabase')}
              placeholderTextColor={colors.mutedForeground}
              className="text-3xl font-bold text-foreground"
              style={
                Platform.OS === 'web' ? { outlineWidth: 0, borderWidth: 0, padding: 0 } : undefined
              }
              underlineColorAndroid="transparent"
            />
          </View>
          <DatabaseActionsMenu databaseId={database.id} />
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
                <ViewTab key={v.id} view={v} database={database} />
              ))}
            </Tabs>
          </View>
          <Button
            appearance="plain"
            size="xs"
            onPress={() => setNewViewOpen(true)}
            leadingIcon={RiAddLine}
          >
            {t('databases.views.new')}
          </Button>
        </View>
      </View>
      <NewViewPicker
        open={newViewOpen}
        onClose={() => setNewViewOpen(false)}
        onChoose={handleAddView}
        pending={createView.isPending}
      />
    </View>
  );
}

interface ViewTabProps {
  readOnly?: boolean;
  view: DatabaseView;
  database: Database;
}

/** One view in a database's `Tabs` strip, with its settings menu beside the label. */
export function ViewTab({ view, database, readOnly = false }: ViewTabProps) {
  const { t } = useTranslation();
  const Icon = VIEW_ICONS[view.type] ?? RiTableLine;
  const [menuOpen, setMenuOpen] = React.useState(false);
  const updateView = useUpdateView();
  const deleteView = useDeleteView();
  const [renameDraft, setRenameDraft] = React.useState<string | null>(null);

  const close = () => {
    setMenuOpen(false);
    setRenameDraft(null);
  };

  const commitRename = async () => {
    if (readOnly || renameDraft === null) return close();
    if (renameDraft.trim() === view.name) return close();
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

  // The settings button is the trigger's `trailing` node: Bloom lays it beside
  // the tab's press target, so opening the menu does not select the view.
  const settings = readOnly ? undefined : (
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
      <PopoverContent align="start" minWidth={240} label={view.name} className="gap-2">
        <PopoverTitle tone="secondary">{view.name}</PopoverTitle>
        {renameDraft === null ? (
          <>
            <Item
              density="compact"
              accessibilityRole="button"
              title={t('databases.views.rename')}
              onPress={() => setRenameDraft(view.name)}
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
        ) : (
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
        )}
      </PopoverContent>
    </Popover>
  );

  return (
    <TabsTrigger
      value={view.id}
      label={view.name}
      leadingIcon={Icon}
      trailing={settings}
      onLongPress={readOnly ? undefined : () => setMenuOpen(true)}
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
