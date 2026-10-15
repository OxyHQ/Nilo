import * as React from 'react';
import { View } from 'react-native';
import { Text } from '@/components/ui/text';
import { SidebarSection } from './sidebar-section';
import { useTranslation } from '@/hooks/useTranslation';

/**
 * Placeholder section for the Databases feature owned by the Databases agent
 * (#16). Renders an empty body that agent #16 will fill with a list of
 * workspace databases. The section is collapsible and persists state in the
 * UI store, so #16 can drop in its content without re-wiring layout.
 */
export function DatabaseSection() {
  const { t } = useTranslation();
  return (
    <SidebarSection sectionKey="databases" title={t('sidebar.sections.databases')}>
      <View className="px-4 py-1.5">
        <Text className="text-xs text-muted-foreground">{t('sidebar.databasesComingSoon')}</Text>
      </View>
    </SidebarSection>
  );
}
