/**
 * One invitation by email (`/invite/<token>`, `app/invite/[token].tsx`), the
 * link the invitation email carries and an admin can copy from Settings ›
 * Members: which workspace and role it gives, then accepting it, signed in
 * (`invitation-screen.tsx`).
 */
import axios from 'axios';
import { InvitationScreen } from '@/components/workspace/invitation-screen';
import { useAcceptInvitation, useInvitationPreview } from '@/lib/hooks/use-workspace-admin';

/** Why the link joins nobody, from the API's answer. */
function refusalOf(error: unknown): 'notFound' | 'expired' | 'accepted' | null {
  if (!axios.isAxiosError(error)) return null;
  const status = error.response?.status;
  const reason = (error.response?.data as { reason?: unknown } | undefined)?.reason;
  if (status === 404) return 'notFound';
  if (status === 410) return reason === 'expired' ? 'expired' : 'accepted';
  return null;
}

export function AcceptInvitation({ token }: { token: string | null }) {
  const preview = useInvitationPreview(token);
  const accept = useAcceptInvitation();
  return (
    <InvitationScreen
      token={token}
      preview={preview}
      accept={accept}
      keys="workspace.acceptInvite"
      refusalOf={refusalOf}
      // An invitation already used: its workspace is the member's to open.
      openAfter="accepted"
    />
  );
}
