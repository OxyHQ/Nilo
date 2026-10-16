import { View } from 'react-native';
import { ChevronDown } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { Button } from '@oxy.so/bloom/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@oxy.so/bloom/dropdown-menu';
import { toast } from '@oxy.so/bloom/toast';
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
        appearance="solid"
        tone="accent"
        size="sm"
        disabled={pending}
        onPress={() => add()}
        accessibilityLabel={t('databases.actions.new')}
      >
        {t('databases.actions.new')}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            iconOnly
            appearance="solid"
            tone="accent"
            size="sm"
            accessibilityLabel={t('databases.templates.menu')}
            renderLeadingIcon={({ size, color }) => <ChevronDown size={size} color={color} />}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" label={t('databases.templates.menu')}>
          {templates.isPending ? (
            <DropdownMenuItem disabled>{t('common.loading')}</DropdownMenuItem>
          ) : null}
          {templates.isError ? (
            <DropdownMenuItem
              onPress={() => {
                void templates.refetch();
              }}
            >
              {t('databases.templates.retry')}
            </DropdownMenuItem>
          ) : null}
          {templates.data?.templates.map((template) => (
            <DropdownMenuSub key={template.id}>
              <DropdownMenuSubTrigger>
                {template.title || t('pages.untitled')}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem disabled={pending} onPress={() => add(template.id)}>
                  {t('databases.templates.use')}
                </DropdownMenuItem>
                <DropdownMenuItem onPress={() => open(template.id)}>
                  {t('databases.templates.edit')}
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={pending}
            onPress={() =>
              createTemplate.mutate(t('databases.templates.new'), {
                onSuccess: (page) => open(page.id),
                onError: () => toast.error(t('databases.templates.createFailed')),
              })
            }
          >
            {t('databases.templates.new')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </View>
  );
}
