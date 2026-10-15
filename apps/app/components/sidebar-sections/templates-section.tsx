import { useRouter } from 'expo-router';
import { toast } from '@oxy.so/bloom/toast';
import { TemplateList } from '@/components/templates/template-list';
import { useDuplicatePage } from '@/lib/hooks/use-pages';
import { useWorkspaceStore } from '@/lib/stores/workspace-store';
import { SidebarSection } from './sidebar-section';
import { useTranslation } from '@/hooks/useTranslation';

export function TemplatesSection() {
  const { t } = useTranslation();
  const router = useRouter();
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const duplicate = useDuplicatePage();
  if (!workspaceId) return null;
  return (
    <SidebarSection sectionKey="templates" title={t('sidebar.sections.templates')}>
      <TemplateList
        workspaceId={workspaceId}
        pending={duplicate.isPending}
        onOpen={(page) => router.push(`/p/${page.id}`)}
        onUse={(page) =>
          duplicate.mutate(
            { id: page.id, workspaceId, fromTemplate: true, parentId: null },
            {
              onSuccess: (created) => router.push(`/p/${created.id}`),
              onError: () => toast.error(t('pages.templates.createFailed')),
            },
          )
        }
      />
    </SidebarSection>
  );
}
