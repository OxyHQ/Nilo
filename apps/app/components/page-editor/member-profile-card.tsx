import { View } from 'react-native';
import { getNormalizedUserHandle } from '@oxy.so/core';
import { Dialog, useDialogControl } from '@oxy.so/bloom/dialog';
import { UserHoverCard } from '@oxy.so/bloom/user-hover-card';
import { useTranslation } from '@/hooks/useTranslation';
import { profileName, useMemberProfiles } from '@/lib/hooks/use-member-profiles';

/**
 * The person a mention names, as a small card: their avatar, name and
 * handle from their Oxy profile. Opened by pressing a person's mention.
 */
export function MemberProfileCard({ userId, onClose }: { userId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const control = useDialogControl();
  const profiles = useMemberProfiles([userId]);
  const profile = profiles.data?.find((candidate) => candidate.id === userId);
  const name = profileName(profile) ?? t('pages.info.unknownMember');
  const handle = profile ? getNormalizedUserHandle(profile) : null;
  return (
    <Dialog
      control={control}
      startOpen
      onClose={onClose}
      placement={{ base: 'bottom', md: 'center' }}
      label={t('editor.mentions.profile', { name })}
      maxWidth={360}
    >
      <View className="items-center">
        <UserHoverCard
          loading={profiles.isLoading}
          animateIn={false}
          avatar={profile?.avatar ?? null}
          displayName={name}
          username={handle && handle !== name ? handle.replace(/^@/, '') : undefined}
          bio={profile?.bio}
        />
      </View>
    </Dialog>
  );
}
