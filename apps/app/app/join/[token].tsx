/**
 * A workspace's invite link (`/join/<token>`): who it is from and the role
 * it gives, then joining, signed in (`invitation-screen.tsx`). Admins make
 * the link in Settings › Members
 * (`components/workspace/workspace-access-sections.tsx`).
 */
import { useLocalSearchParams } from 'expo-router';
import axios from 'axios';
import { InvitationScreen } from '@/components/workspace/invitation-screen';
import { useInviteLinkPreview, useJoinWorkspace } from '@/lib/hooks/use-workspace-admin';

export default function JoinWorkspaceRoute() {
  const { token } = useLocalSearchParams<{ token: string }>();
  return <JoinWorkspace key={token} token={typeof token === 'string' ? token : null} />;
}

/** Why the link joins nobody: there is no such link, or it was turned off. */
function refusalOf(error: unknown): 'notFound' | 'disabled' | null {
  const status = axios.isAxiosError(error) ? error.response?.status : undefined;
  if (status === 404) return 'notFound';
  if (status === 410) return 'disabled';
  return null;
}

function JoinWorkspace({ token }: { token: string | null }) {
  const preview = useInviteLinkPreview(token);
  const join = useJoinWorkspace();
  return (
    <InvitationScreen
      token={token}
      preview={preview}
      accept={join}
      keys="workspace.join"
      refusalOf={refusalOf}
    />
  );
}
