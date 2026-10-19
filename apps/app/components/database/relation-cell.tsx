import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Chip } from '@oxy.so/bloom/chip';
import { useTranslation } from '@/hooks/useTranslation';
import { useRelatedRows } from '@/lib/hooks/use-database-rows';

/** The rows a relation points at, as pills that open them; read in one request for the cell. */
export function RelationCell({
  value,
  targetDatabaseId,
}: {
  value: string[];
  targetDatabaseId?: string;
}) {
  const { data, isError } = useRelatedRows(targetDatabaseId, value);
  const router = useRouter();
  const { t } = useTranslation();
  const byId = new Map((data ?? []).map((row) => [row.id, row]));
  return (
    <View className="flex-row flex-wrap gap-1">
      {value.map((id) => {
        const row = byId.get(id);
        // Read, and not there: no longer a live row of the related database.
        const title =
          row?.title ||
          t(
            row
              ? 'databases.untitled'
              : isError || data
                ? 'databases.relations.unavailable'
                : 'common.loading',
          );
        return (
          <Chip
            key={id}
            size="sm"
            // The cell or card around the pill opens the row.
            stopPropagation
            accessibilityLabel={title}
            onPress={() => router.push({ pathname: '/p/[pageId]', params: { pageId: id } })}
          >
            {title}
          </Chip>
        );
      })}
    </View>
  );
}
