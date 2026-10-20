/** An invitation's own link: `components/workspace/accept-invitation.tsx`. */
import { useLocalSearchParams } from 'expo-router';
import { AcceptInvitation } from '@/components/workspace/accept-invitation';

export default function AcceptInvitationRoute() {
  const { token } = useLocalSearchParams<{ token: string }>();
  return <AcceptInvitation key={token} token={typeof token === 'string' ? token : null} />;
}
