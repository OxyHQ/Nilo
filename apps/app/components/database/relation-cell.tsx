import { View, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { Text } from '@oxy.so/bloom/typography';
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
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={title}
      onPress={(event) => {
        event.stopPropagation();
        router.push({ pathname: '/p/[pageId]', params: { pageId: id } });
      }}
      className="rounded bg-muted px-2 py-1"
    >
      <Text variant="body-regular">{title}</Text>
    </Pressable>
  );
}
