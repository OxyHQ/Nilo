import { Avatar } from '@oxy.so/bloom/avatar';
import type { Workspace } from '@/lib/hooks/use-workspaces';

interface WorkspaceAvatarProps {
  workspace: Pick<Workspace, 'name' | 'avatar'>;
  size?: number;
}

/**
 * A workspace's picture, or its initial when it has none. The squircle sets a
 * workspace apart from the round avatars of the people in it.
 */
export function WorkspaceAvatar({ workspace, size = 24 }: WorkspaceAvatarProps) {
  return (
    <Avatar
      source={workspace.avatar ?? undefined}
      name={workspace.name}
      shape="squircle"
      size={size}
    />
  );
}
