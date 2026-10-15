import { View, Pressable } from 'react-native';
import { ChevronDown } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { toast } from '@oxy.so/bloom/toast';
import * as DropdownMenu from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { useTranslation } from '@/hooks/useTranslation';
import { useCreateRow } from '@/lib/hooks/use-database-rows';
import { useCreateRowTemplate, useRowTemplates } from '@/lib/hooks/use-row-templates';

export function NewRowMenu({ databaseId }: { databaseId: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const templates = useRowTemplates(databaseId);
  const create = useCreateRow();
  const createTemplate = useCreateRowTemplate(databaseId);
  const pending = create.isPending || createTemplate.isPending;
  const open = (id: string) => router.push({ pathname: '/p/[pageId]', params: { pageId: id } });
  const add = (templateId?: string) =>
    create.mutate(
      { databaseId, templateId },
      {
        onSuccess: (row) => open(row.id),
        onError: () => toast.error(t('databases.templates.createFailed')),
      },
    );
  return (
    <View className="flex-row items-center gap-1">
      <Button
        size="sm"
        disabled={pending}
        onPress={() => add()}
        accessibilityLabel={t('databases.actions.new')}
      >
        <Text>{t('databases.actions.new')}</Text>
      </Button>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('databases.templates.menu')}
            className="rounded bg-primary p-2"
          >
            <ChevronDown size={16} className="text-primary-foreground" />
          </Pressable>
        </DropdownMenu.Trigger>
        <DropdownMenu.Content>
          {templates.isPending ? (
            <DropdownMenu.Item key="loading" disabled>
              <DropdownMenu.ItemTitle>{t('common.loading')}</DropdownMenu.ItemTitle>
            </DropdownMenu.Item>
          ) : null}
          {templates.isError ? (
            <DropdownMenu.Item
              key="retry"
              onSelect={() => {
                void templates.refetch();
              }}
            >
              <DropdownMenu.ItemTitle>{t('databases.templates.retry')}</DropdownMenu.ItemTitle>
            </DropdownMenu.Item>
          ) : null}
          {templates.data?.templates.map((template) => (
            <DropdownMenu.Sub key={template.id}>
              <DropdownMenu.SubTrigger key={template.id}>
                <DropdownMenu.ItemTitle>
                  {template.title || t('pages.untitled')}
                </DropdownMenu.ItemTitle>
              </DropdownMenu.SubTrigger>
              <DropdownMenu.SubContent>
                <DropdownMenu.Item key="use" disabled={pending} onSelect={() => add(template.id)}>
                  <DropdownMenu.ItemTitle>{t('databases.templates.use')}</DropdownMenu.ItemTitle>
                </DropdownMenu.Item>
                <DropdownMenu.Item key="edit" onSelect={() => open(template.id)}>
                  <DropdownMenu.ItemTitle>{t('databases.templates.edit')}</DropdownMenu.ItemTitle>
                </DropdownMenu.Item>
              </DropdownMenu.SubContent>
            </DropdownMenu.Sub>
          ))}
          <DropdownMenu.Separator />
          <DropdownMenu.Item
            key="new-template"
            disabled={pending}
            onSelect={() =>
              createTemplate.mutate(t('databases.templates.new'), {
                onSuccess: (page) => open(page.id),
                onError: () => toast.error(t('databases.templates.createFailed')),
              })
            }
          >
            <DropdownMenu.ItemTitle>{t('databases.templates.new')}</DropdownMenu.ItemTitle>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </View>
  );
}
