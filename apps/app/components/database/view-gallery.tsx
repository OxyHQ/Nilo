import { RowsScrollView } from './rows-scroll-view';
import { CoverDisplay } from '@/components/page-chrome/cover-display';
import * as React from 'react';
import { Image, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { RiImageLine } from '@oxy.so/bloom/icons/RiImageLine';
import { RiAddLine } from '@oxy.so/bloom/icons/RiAddLine';
import { Loading } from '@oxy.so/bloom/loading';
import { Text } from '@oxy.so/bloom/typography';
import { useTranslation } from '@/hooks/useTranslation';
import { useColorScheme } from '@/lib/useColorScheme';
import type { Database, DatabaseRow, DatabaseView } from '@/lib/types/databases';
import { useCreateRow } from '@/lib/hooks/use-database-rows';
import { PropertyCell } from './property-cell';

interface ViewGalleryProps {
  database: Database;
  view: DatabaseView;
  rows: DatabaseRow[];
  isLoading: boolean;
  readOnly?: boolean;
  onLoadMore?: () => void;
}

const CARD_WIDTH = 240;

/**
 * Gallery view — grid of cards. Each card shows the row's cover (or a
 * configured file property), title, and a few preview properties.
 */
export function ViewGallery({
  database,
  view,
  rows,
  isLoading,
  readOnly = false,
  onLoadMore,
}: ViewGalleryProps) {
  const router = useRouter();
  const { colors } = useColorScheme();
  const { t } = useTranslation();
  const createRow = useCreateRow();

  const visibleProperties = React.useMemo(() => {
    return database.schema.properties.filter(
      (p) => !view.hiddenProperties.includes(p.id) && p.id !== 'name',
    );
  }, [database.schema.properties, view.hiddenProperties]);

  if (isLoading) {
    return (
      <View className="py-10 items-center">
        <Loading variant="spinner" />
      </View>
    );
  }

  return (
    <RowsScrollView onLoadMore={onLoadMore}>
      <View className="flex-row flex-wrap gap-3 p-3">
        {rows.map((row) => {
          const cover = readCover(row, view, database);
          return (
            <Pressable
              key={row.id}
              accessibilityRole="link"
              accessibilityLabel={row.title || t('databases.untitled')}
              onPress={() => router.push(`/p/${row.id}`)}
              className="bg-card border border-border rounded-xl overflow-hidden"
              style={{ width: CARD_WIDTH }}
            >
              {view.config.coverSource === 'none' ? null : (
                <View className="h-32 bg-muted items-center justify-center overflow-hidden">
                  {cover?.kind === 'page' ? (
                    <View className="w-full">
                      <CoverDisplay value={cover.value} height={128} />
                    </View>
                  ) : cover ? (
                    <Image
                      source={{ uri: cover.url }}
                      style={{ width: '100%', height: '100%' }}
                      resizeMode={view.config.fit === 'contain' ? 'contain' : 'cover'}
                      accessible={false}
                    />
                  ) : (
                    <RiImageLine size="lg" fill={colors.mutedForeground} />
                  )}
                </View>
              )}
              <View className="p-3 gap-1">
                <Text variant="body-medium" numberOfLines={2}>
                  {row.title || t('databases.untitled')}
                </Text>
                <View className="gap-1">
                  {visibleProperties.slice(0, 3).map((property) => (
                    <View key={property.id} className="flex-row items-center gap-2">
                      <PropertyCell
                        readOnly={readOnly}
                        property={property}
                        value={row.properties[property.id] ?? null}
                        variant="card"
                        onChange={() => router.push(`/p/${row.id}`)}
                      />
                    </View>
                  ))}
                </View>
              </View>
            </Pressable>
          );
        })}

        {!readOnly ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('databases.actions.new')}
            disabled={createRow.isPending}
            onPress={() => createRow.mutate({ databaseId: database.id })}
            className="border border-dashed border-border rounded-xl items-center justify-center"
            style={{ width: CARD_WIDTH, height: 200 }}
          >
            <RiAddLine size="md" fill={colors.mutedForeground} />
            <Text className="mt-1 text-sm text-muted-foreground">
              {createRow.isPending ? t('databases.actions.adding') : t('databases.gallery.newCard')}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </RowsScrollView>
  );
}

function readCover(
  row: DatabaseRow,
  view: DatabaseView,
  database: Database,
): { kind: 'url'; url: string } | { kind: 'page'; value: string } | null {
  const source = view.config.coverSource ?? 'pageCover';
  // A page's cover is stored encoded (a gradient, a colour, an image): shown as its page shows it.
  if (source === 'pageCover' && row.cover) {
    return { kind: 'page', value: row.cover };
  }
  if (source === 'property' && view.config.coverPropertyId) {
    const property = database.schema.properties.find((p) => p.id === view.config.coverPropertyId);
    if (property?.type === 'files') {
      const value = row.properties[property.id];
      if (value && typeof value === 'object' && 'files' in value) {
        const files = value.files;
        if (Array.isArray(files) && files.length > 0) {
          const first = files[0];
          if (
            first &&
            typeof first === 'object' &&
            'url' in first &&
            typeof first.url === 'string'
          ) {
            return { kind: 'url', url: first.url };
          }
        }
      }
    }
  }
  return null;
}
