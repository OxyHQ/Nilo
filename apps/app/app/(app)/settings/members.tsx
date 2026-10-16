import React from 'react';
import { View, ScrollView } from 'react-native';
import { useOxy } from '@oxy.so/services';
import { useRouter } from 'expo-router';
import { Text } from '@oxy.so/bloom/typography';
import { useTranslation } from '@/hooks/useTranslation';
import { SettingsHeader } from '@/components/settings/settings-header';
import { MembersSection } from '@/components/workspace/members-section';

export default function SettingsMembersScreen() {
  const router = useRouter();
  const { isAuthenticated } = useOxy();
  const { t } = useTranslation();

  React.useEffect(() => {
    if (!isAuthenticated) {
      router.replace('/(app)');
    }
  }, [isAuthenticated, router]);

  if (!isAuthenticated) return null;

  return (
    <View className="flex-1 bg-background">
      <SettingsHeader title={t('settings.sections.members')} />
      <ScrollView className="flex-1" contentContainerClassName="p-5 max-w-3xl gap-6">
        <View className="gap-1">
          <Text variant="headline-semibold">{t('settings.members.title')}</Text>
          <Text className="text-sm text-muted-foreground">{t('settings.members.description')}</Text>
        </View>
        <MembersSection />
      </ScrollView>
    </View>
  );
}
