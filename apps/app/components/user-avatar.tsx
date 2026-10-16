import { useOxy } from '@oxy.so/services';
import { Avatar } from '@oxy.so/bloom/avatar';

interface UserAvatarProps {
  size?: number;
}

export function UserAvatar({ size = 24 }: UserAvatarProps) {
  const { user } = useOxy();

  const initial = (user?.name?.first?.[0] || user?.username?.[0] || 'U').toUpperCase();

  // `source` is the bare Oxy file id: the resolver mounted in the root layout
  // turns it into the thumb rendition's URL.
  return <Avatar source={user?.avatar ?? null} initials={initial} size={size} />;
}
