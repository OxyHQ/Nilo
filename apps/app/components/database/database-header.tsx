import * as React from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import {
  Calendar,
  GalleryVertical,
  Image as ImageIcon,
  Kanban,
  ListIcon,
  Plus,
  Settings2,
  Table as TableIcon,
  TimerReset,
} from 'lucide-react-native';
import { Text } from '@/components/ui/text';
import { useTranslation } from '@/hooks/useTranslation';
import i18n from '@/lib/i18n';
import { useColorScheme } from '@/lib/useColorScheme';
import type { Database, DatabaseView, DatabaseViewType } from '@/lib/types/databases';
import { useUpdateDatabase } from '@/lib/hooks/use-databases';
import { useCreateView, useDeleteView, useUpdateView } from '@/lib/hooks/use-database-views';
import { centeredModalStyle } from './centered-modal-style';

const VIEW_ICONS: Record<
  DatabaseViewType,
  React.ComponentType<{ size?: number; color?: string }>
> = {
  table: TableIcon,
  board: Kanban,
  gallery: GalleryVertical,
  list: ListIcon,
  calendar: Calendar,
  timeline: TimerReset,
};

/** Translated at call time: the locale can change while the app runs. */
function viewTypeLabel(type: DatabaseViewType): string {
  switch (type) {
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
    const created = await createView.mutateAsync({
      databaseId: database.id,
      name: viewTypeLabel(type),
      type,
    });
    setNewViewOpen(false);
    onSelectView(created.id);
  };

  return (
    <View className="border-b border-border/30">
      {database.cover ? (
        <View className="h-32 bg-muted">
          {/* Cover image — Phase 4 keeps it visually simple. */}
          <View className="absolute inset-0 items-center justify-center">
            <ImageIcon size={28} color="#9ca3af" />
          </View>
        </View>
      ) : null}
      <View className="px-6 py-4 gap-3">
        <View className="flex-row items-center gap-2">
          {database.icon ? (
            <Text className="text-4xl leading-none">{database.icon}</Text>
          ) : (
            <TableIcon size={28} color={colors.foreground} />
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
        </View>

        {/* View tabs */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerClassName="flex-row items-center gap-1"
        >
          {views.map((v) => (
            <ViewTab
              key={v.id}
              view={v}
              active={v.id === activeViewId}
              onPress={() => onSelectView(v.id)}
              database={database}
            />
          ))}
          <Pressable
            onPress={() => setNewViewOpen(true)}
            className="flex-row items-center gap-1 px-2 py-1 rounded hover:bg-muted"
          >
            <Plus size={12} color={colors.mutedForeground} />
            <Text className="text-xs text-muted-foreground">{t('databases.views.new')}</Text>
          </Pressable>
        </ScrollView>
      </View>
      <NewViewPicker
        open={newViewOpen}
        onClose={() => setNewViewOpen(false)}
        onChoose={handleAddView}
      />
    </View>
  );
}

interface ViewTabProps {
  view: DatabaseView;
  active: boolean;
  onPress: () => void;
  database: Database;
}

function ViewTab({ view, active, onPress, database }: ViewTabProps) {
  const { colors } = useColorScheme();
  const { t } = useTranslation();
  const Icon = VIEW_ICONS[view.type] ?? TableIcon;
  const [menuOpen, setMenuOpen] = React.useState(false);
  const updateView = useUpdateView();
  const deleteView = useDeleteView();
  const [renameDraft, setRenameDraft] = React.useState<string | null>(null);

  const close = () => {
    setMenuOpen(false);
    setRenameDraft(null);
  };

  const commitRename = async () => {
    if (renameDraft === null) return close();
    if (renameDraft.trim() === view.name) return close();
    await updateView.mutateAsync({
      databaseId: database.id,
      viewId: view.id,
      name: renameDraft.trim(),
    });
    close();
  };

  return (
    <View>
      <Pressable
        onPress={onPress}
        onLongPress={() => setMenuOpen(true)}
        className={`flex-row items-center gap-1.5 px-2 py-1 rounded ${
          active ? 'bg-muted' : 'hover:bg-muted/60'
        }`}
      >
        <Icon size={12} color={colors.foreground} />
        <Text
          className={`text-xs ${active ? 'text-foreground font-medium' : 'text-muted-foreground'}`}
        >
          {view.name}
        </Text>
        <Pressable
          onPress={() => setMenuOpen(true)}
          className="p-0.5 rounded hover:bg-muted-foreground/10"
        >
          <Settings2 size={10} color={colors.mutedForeground} />
        </Pressable>
      </Pressable>

      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={close}>
        <Pressable style={StyleSheet.absoluteFill} className="bg-black/40" onPress={close} />
        <View
          className="absolute left-0 right-0 bottom-0 web:bottom-auto web:top-1/2 web:left-1/2"
          style={centeredModalStyle(260, 200)}
        >
          <View className="bg-popover border border-border rounded-2xl shadow-xl p-3 m-3 web:m-0 gap-2">
            <Text className="text-xs uppercase tracking-wider text-muted-foreground">
              {view.name}
            </Text>
            {renameDraft === null ? (
              <>
                <Pressable
                  onPress={() => setRenameDraft(view.name)}
                  className="px-2 py-1.5 rounded hover:bg-muted"
                >
                  <Text className="text-sm text-foreground">{t('databases.views.rename')}</Text>
                </Pressable>
                <Pressable
                  onPress={async () => {
                    await deleteView.mutateAsync({
                      databaseId: database.id,
                      viewId: view.id,
                    });
                    close();
                  }}
                  className="px-2 py-1.5 rounded hover:bg-muted"
                >
                  <Text className="text-sm text-red-500">{t('databases.views.delete')}</Text>
                </Pressable>
              </>
            ) : (
              <>
                <TextInput
                  value={renameDraft}
                  onChangeText={setRenameDraft}
                  placeholder={t('databases.views.namePlaceholder')}
                  placeholderTextColor={colors.mutedForeground}
                  className="text-sm text-foreground border border-border rounded-md px-2 py-1"
                  style={Platform.OS === 'web' ? { outlineWidth: 0 } : undefined}
                  underlineColorAndroid="transparent"
                  autoFocus
                  onSubmitEditing={commitRename}
                />
                <View className="flex-row justify-end gap-2 mt-1">
                  <Pressable onPress={close} className="px-3 py-1 rounded-md bg-muted">
                    <Text className="text-sm text-foreground">{t('common.cancel')}</Text>
                  </Pressable>
                  <Pressable onPress={commitRename} className="px-3 py-1 rounded-md bg-primary">
                    <Text className="text-sm text-primary-foreground">{t('common.save')}</Text>
                  </Pressable>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

interface NewViewPickerProps {
  open: boolean;
  onClose: () => void;
  onChoose: (type: DatabaseViewType) => void;
}

function NewViewPicker({ open, onClose, onChoose }: NewViewPickerProps) {
  const { colors } = useColorScheme();
  const { t } = useTranslation();
  const types: DatabaseViewType[] = ['table', 'board', 'gallery', 'list', 'calendar', 'timeline'];

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={StyleSheet.absoluteFill} className="bg-black/40" onPress={onClose} />
      <View
        className="absolute left-0 right-0 bottom-0 web:bottom-auto web:top-1/2 web:left-1/2"
        style={centeredModalStyle(280, 340)}
      >
        <View className="bg-popover border border-border rounded-2xl shadow-xl p-3 m-3 web:m-0">
          <Text className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
            {t('databases.views.new')}
          </Text>
          {types.map((type) => {
            const Icon = VIEW_ICONS[type];
            return (
              <Pressable
                key={type}
                onPress={() => onChoose(type)}
                className="flex-row items-center gap-2 px-2 py-2 rounded hover:bg-muted"
              >
                <Icon size={14} color={colors.foreground} />
                <Text className="text-sm text-foreground">{viewTypeLabel(type)}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </Modal>
  );
}
