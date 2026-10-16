import { View } from 'react-native';
import { Text } from '@oxy.so/bloom/typography';
import { SettingsListGroup, SettingsListItem } from '@oxy.so/bloom/settings-list';
import { useOxy } from '@oxy.so/services';
import { useTranslation } from '@/hooks/useTranslation';
import { UserAvatar } from '@/components/user-avatar';

export function AccountSection() {
  const { user, showBottomSheet } = useOxy();
  const { t } = useTranslation();

  const displayName = user?.name?.first
    ? user.name.last
      ? `${user.name.first} ${user.name.last}`
      : user.name.first
    : user?.username || t('common.user');

  return (
    <View className="gap-6">
      {/* Profile Card */}
      <View className="flex-row items-center gap-4">
        <UserAvatar size={56} />
        <View className="flex-1">
          <Text variant="title-3-semibold">{displayName}</Text>
          {user?.email && <Text className="text-sm text-muted-foreground">{user.email}</Text>}
        </View>
      </View>

      {/* Manage Account */}
      <SettingsListGroup>
        <SettingsListItem
          title={t('settings.account.title')}
          onPress={() => showBottomSheet?.('ManageAccount')}
        />
      </SettingsListGroup>
    </View>
  );
}
