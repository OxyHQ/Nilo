import { View } from 'react-native';
import { useOxy } from '@oxy.so/services';
import { Avatar } from '@oxy.so/bloom/avatar';
import { Text } from '@/components/ui/text';
import { useTranslation } from '@/hooks/useTranslation';
import { profileName, useMemberProfiles } from '@/lib/hooks/use-member-profiles';
import type { Collaborator } from '@/lib/editor/use-page-editor';

export function PresenceAvatars({ collaborators }: { collaborators: Collaborator[] }) {
  const { user } = useOxy();
  const { t } = useTranslation();
  const ids = [...new Set(collaborators.map((person) => person.userId))]
    .filter((id) => id !== user?.id)
    .sort();
  const profiles = useMemberProfiles(ids.slice(0, 6));
  if (!ids.length) return null;
  return (
    <View className="flex-row items-center">
      {ids.slice(0, 6).map((id, index) => {
        const profile = profiles.data?.find((person) => person.id === id);
        const name = profileName(profile) ?? t('pages.info.unknownMember');
        return (
          <View
            key={id}
            style={{ marginLeft: index ? -6 : 0 }}
            className="rounded-full border-2 border-background"
          >
            <Avatar
              size="sm"
              source={profile?.avatar}
              name={name}
              alt={t('editor.status.present', { name })}
            />
          </View>
        );
      })}
      {ids.length > 6 ? (
        <Text className="ml-2 text-xs text-muted-foreground">
          {t('editor.status.morePresent', { count: ids.length - 6 })}
        </Text>
      ) : null}
    </View>
  );
}
