import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Chip } from '@oxy.so/bloom/chip';
import { useTranslation } from '@/hooks/useTranslation';
import { useDatabaseRow } from '@/lib/hooks/use-database-rows';

export function RelationCell({
  value,
  targetDatabaseId,
}: {
  value: string[];
  targetDatabaseId?: string;
}) {
  return (
    <View className="flex-row flex-wrap gap-1">
      {value.map((id) => (
        <RelatedRow key={id} id={id} databaseId={targetDatabaseId} />
      ))}
    </View>
  );
}

function RelatedRow({ id, databaseId }: { id: string; databaseId?: string }) {
  const { data, isError } = useDatabaseRow(databaseId, id);
  const router = useRouter();
  const { t } = useTranslation();
  const title =
    data?.title ||
    t(isError ? 'databases.relations.unavailable' : data ? 'databases.untitled' : 'common.loading');
  return (
    <Chip
      size="sm"
      // The cell or card around the pill opens the row.
      stopPropagation
      accessibilityLabel={title}
      onPress={() => router.push({ pathname: '/p/[pageId]', params: { pageId: id } })}
    >
      {title}
    </Chip>
  );
}
