import { GroupedSection, GroupedSectionItem } from '@oxy.so/bloom/grouped-section';
import { View } from 'react-native';
import { Avatar } from '@oxy.so/bloom/avatar';
import { Button } from '@oxy.so/bloom/button';
import { RiExternalLinkLine } from '@oxy.so/bloom/icons/RiExternalLinkLine';

import { getAccountDisplayName } from '@oxy.so/core';
import { Text } from '@oxy.so/bloom/typography';
import { useOxy } from '@oxy.so/services/ui/client';
import { useTranslation } from '@/hooks/useTranslation';
import { useNiloSettings } from './settings-provider';

/**
 * The Oxy account behind Nilo. The identity is Oxy's, so it is shown here and
 * edited in Oxy's own account surface.
 */
export function AccountSection() {
  const { user, isAuthenticated, showBottomSheet, openAccountDialog } = useOxy();
  const { t, locale } = useTranslation();
  const { afterClose } = useNiloSettings();

  if (!isAuthenticated || !user) {
    return (
      <GroupedSection>
        <GroupedSectionItem
          wrapControl
          title={t('settings.account.signedOut')}
          rightElement={
            <>
              <Button tone="action" size="sm" onPress={() => afterClose(() => openAccountDialog())}>
                {t('login.signInButton')}
              </Button>
            </>
          }
        />
      </GroupedSection>
    );
  }

  const displayName = getAccountDisplayName(user, locale);

  return (
    <View className="gap-6">
      <View className="flex-row items-center gap-4">
        <Avatar source={user.avatar ?? undefined} name={displayName} size={56} />
        <View className="flex-1 min-w-0">
          <Text variant="title-3-semibold" numberOfLines={1}>
            {displayName}
          </Text>
          {user.username ? (
            <Text className="text-sm text-muted-foreground" numberOfLines={1}>
              @{user.username}
            </Text>
          ) : null}
          {user.email ? (
            <Text className="text-sm text-muted-foreground" numberOfLines={1}>
              {user.email}
            </Text>
          ) : null}
        </View>
      </View>

      <GroupedSection>
        <GroupedSectionItem
          wrapControl
          title={t('settings.account.title')}
          description={t('settings.account.description')}
          rightElement={
            <>
              <Button
                appearance="outline"
                tone="neutral"
                size="sm"
                leadingIcon={RiExternalLinkLine}
                onPress={() => afterClose(() => showBottomSheet?.('ManageAccount'))}
              >
                {t('settings.account.manage')}
              </Button>
            </>
          }
        />
      </GroupedSection>
    </View>
  );
}
