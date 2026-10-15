import { View } from 'react-native';
import { Text } from '@/components/ui/text';
import { SidebarSection } from './sidebar-section';
import { useTranslation } from '@/hooks/useTranslation';

/**
 * Templates — placeholder until Phase 5 ships the template gallery. Section
 * defaults to collapsed so it doesn't take up space in normal use.
 */
export function TemplatesSection() {
  const { t } = useTranslation();
  return (
    <SidebarSection sectionKey="templates" title={t('sidebar.sections.templates')}>
      <View className="px-4 py-1.5">
        <Text className="text-xs text-muted-foreground">{t('sidebar.templatesHint')}</Text>
      </View>
    </SidebarSection>
  );
}
