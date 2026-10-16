import { Avatar } from '@oxy.so/bloom/avatar';
import { useOxy } from '@oxy.so/services';
import type { Workspace } from '@/lib/hooks/use-workspaces';

interface WorkspaceAvatarProps {
  workspace: Pick<Workspace, 'name' | 'avatar'> &
    Partial<Pick<Workspace, 'isPersonal' | 'ownerId'>>;
  size?: number;
}

/**
 * A workspace's picture, or its initial when it has none. The squircle sets a
 * workspace apart from the round avatars of the people in it.
 *
 * The caller's own personal workspace with no picture of its own shows the
 * caller's Oxy avatar: that workspace is theirs alone, so their face is the
 * natural default, and a picture set on the workspace still wins.
 */
export function WorkspaceAvatar({ workspace, size = 24 }: WorkspaceAvatarProps) {
  const { user } = useOxy();
  const ownAvatar =
    workspace.isPersonal && user && workspace.ownerId === user.id ? user.avatar : undefined;
  return (
    <Avatar
      source={workspace.avatar ?? ownAvatar ?? undefined}
      name={workspace.name}
      shape="squircle"
      size={size}
    />
  );
}
