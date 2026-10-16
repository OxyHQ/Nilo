import React from 'react';
import { View } from 'react-native';
import { Button } from '@oxy.so/bloom/button';
import { Item } from '@oxy.so/bloom/item';
import { Text } from '@oxy.so/bloom/typography';
import { BaseSidebar } from '@/components/base-sidebar';
import { useRouter, usePathname } from 'expo-router';
import { useTranslation } from '@/hooks/useTranslation';
import { useColorScheme } from '@/lib/useColorScheme';
import {
  User,
  Settings2,
  MessageSquarePlus,
  ArrowLeft,
  Users,
  CloudOff,
  type LucideIcon,
} from 'lucide-react-native';

interface SettingsSection {
  id: string;
  route: string;
  icon: LucideIcon;
  labelKey: string;
}

const SECTIONS: SettingsSection[] = [
  { id: 'account', route: '/(app)/settings', icon: User, labelKey: 'settings.sections.account' },
  {
    id: 'members',
    route: '/(app)/settings/members',
    icon: Users,
    labelKey: 'settings.sections.members',
  },
  {
    id: 'general',
    route: '/(app)/settings/general',
    icon: Settings2,
    labelKey: 'settings.sections.general',
  },
  {
    id: 'offline',
    route: '/(app)/settings/offline',
    icon: CloudOff,
    labelKey: 'settings.sections.offline',
  },
  {
    id: 'feedback',
    route: '/(app)/settings/feedback',
    icon: MessageSquarePlus,
    labelKey: 'settings.sections.feedback',
  },
];

export const SettingsSidebar = React.memo(function SettingsSidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useTranslation();
  const { colors } = useColorScheme();

  const activeId = React.useMemo(() => {
    if (pathname.includes('/settings/members')) return 'members';
    if (pathname.includes('/settings/general')) return 'general';
    if (pathname.includes('/settings/offline')) return 'offline';
    if (pathname.includes('/settings/feedback')) return 'feedback';
    return 'account';
  }, [pathname]);

  const handleSelect = (section: SettingsSection) => {
    router.push(section.route as Parameters<typeof router.push>[0]);
  };

  const handleBack = () => {
    router.replace('/(app)');
  };

  const header = (
    <View className="px-3 pt-4 pb-2">
      <Button
        appearance="plain"
        size="sm"
        className="self-start"
        onPress={handleBack}
        renderLeadingIcon={({ size, color }) => <ArrowLeft size={size} color={color} />}
      >
        {t('common.back')}
      </Button>
    </View>
  );

  const footer = <View />;

  return (
    <BaseSidebar header={header} footer={footer}>
      <View className="px-3 py-1">
        <Text className="text-[11px] font-semibold text-muted-foreground tracking-wider uppercase px-2 mb-1">
          {t('settings.title')}
        </Text>
        <View className="gap-0.5">
          {SECTIONS.map((section) => {
            const Icon = section.icon;
            const isActive = activeId === section.id;

            return (
              <Item
                key={section.id}
                density="compact"
                active={isActive}
                onPress={() => handleSelect(section)}
                leading={
                  <Icon size={16} color={isActive ? colors.foreground : colors.mutedForeground} />
                }
                title={t(section.labelKey)}
              />
            );
          })}
        </View>
      </View>
    </BaseSidebar>
  );
});
