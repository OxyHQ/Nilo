import { View } from 'react-native';
import { Text } from '@oxy.so/bloom/typography';
import { useTranslation } from '@/hooks/useTranslation';
import { useSharedPages } from '@/lib/hooks/use-page-permissions';
import { SidebarSection } from './sidebar-section';
import { SidebarPageTree } from './sidebar-page-tree';

export function SharedWithMeSection() {
  const { data } = useSharedPages();
  const { t } = useTranslation();
  const groups = data?.shared.filter((group) => group.pages.length > 0) ?? [];
  if (groups.length === 0) return null;
  return (
    <SidebarSection title={t('sidebar.sections.sharedWithMe')} collapsible={false}>
      {groups.map(({ workspace, pages }) => (
        <View key={workspace.id} className="px-1 py-1">
          <Text className="text-xs text-muted-foreground px-3 py-1" numberOfLines={1}>
            {workspace.icon ? `${workspace.icon} ` : ''}
            {workspace.name}
          </Text>
          <SidebarPageTree pages={pages} workspaceId={workspace.id} enableDrag={false} readOnly />
        </View>
      ))}
    </SidebarSection>
  );
}
