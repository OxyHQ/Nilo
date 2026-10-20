/**
 * One invitation by email (`/invite/<token>`, `app/invite/[token].tsx`), the
 * link the invitation email carries and an admin can copy from Settings ›
 * Members: which workspace and role it gives, then accepting it, signed in.
 * Signing in or creating an Oxy account happens in the account dialog, and
 * this screen stays put, so the invitation is accepted with whichever account
 * that is.
 */
import type React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useOxy } from '@oxy.so/services/ui/client';
import axios from 'axios';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@oxy.so/bloom/button';
import { EmptyState } from '@oxy.so/bloom/empty-state';
import { Loading } from '@oxy.so/bloom/loading';
import { toast } from '@oxy.so/bloom/toast';
import { Text } from '@oxy.so/bloom/typography';
import { WorkspaceAvatar } from '@/components/workspace/workspace-avatar';
import { roleLabel } from '@/components/workspace/role-labels';
import { useTranslation } from '@/hooks/useTranslation';
import { apiErrorMessage } from '@/lib/api/error-message';
import { useAcceptInvitation, useInvitationPreview } from '@/lib/hooks/use-workspace-admin';
import { useWorkspaceStore } from '@/lib/stores/workspace-store';

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
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isAuthenticated, openAccountDialog } = useOxy();
  const setCurrentWorkspaceId = useWorkspaceStore((s) => s.setCurrentWorkspaceId);
  const preview = useInvitationPreview(token);
  const accept = useAcceptInvitation();

  const refusal = token ? refusalOf(accept.error ?? preview.error) : 'notFound';
  const name = preview.data?.workspace.name ?? '';

  const handleAccept = () => {
    if (!token) return;
    accept.mutate(token, {
      onSuccess: (result) => {
        toast.success(
          t(
            result.joined
              ? 'workspace.acceptInvite.joined'
              : 'workspace.acceptInvite.alreadyMember',
            {
              name,
            },
          ),
        );
        setCurrentWorkspaceId(result.workspaceId);
        router.replace('/(app)');
      },
    });
  };

  let body: React.ReactNode;
  if (refusal) {
    body = (
      <View className="items-center gap-4">
        <EmptyState
          title={t(`workspace.acceptInvite.${refusal}Title`)}
          description={t(`workspace.acceptInvite.${refusal}Body`)}
        />
        {refusal === 'accepted' && isAuthenticated ? (
          <Button
            appearance="outline"
            tone="neutral"
            accessibilityLabel={t('workspace.acceptInvite.open')}
            onPress={() => router.replace('/(app)')}
          >
            {t('workspace.acceptInvite.open')}
          </Button>
        ) : null}
      </View>
    );
  } else if (preview.isPending) {
    body = <Loading variant="spinner" accessibilityLabel={t('common.loading')} />;
  } else if (!preview.data) {
    body = (
      <EmptyState
        title={t('workspace.acceptInvite.failed')}
        description={apiErrorMessage(preview.error, t('workspace.acceptInvite.failed'))}
      />
    );
  } else {
    body = (
      <View className="items-center gap-4">
        <WorkspaceAvatar workspace={preview.data.workspace} size={56} />
        <Text accessibilityRole="header" variant="title-2-semibold" className="text-center">
          {t('workspace.acceptInvite.title', { name })}
        </Text>
        <Text className="text-base text-muted-foreground text-center">
          {t('workspace.acceptInvite.description', { name, role: roleLabel(preview.data.role) })}
        </Text>
        {isAuthenticated ? (
          <Button
            appearance="solid"
            tone="accent"
            accessibilityLabel={t('workspace.acceptInvite.submit')}
            disabled={accept.isPending}
            loading={accept.isPending}
            onPress={handleAccept}
          >
            {t('workspace.acceptInvite.submit')}
          </Button>
        ) : (
          <>
            <Text className="text-sm text-muted-foreground text-center">
              {t('workspace.acceptInvite.signIn')}
            </Text>
            <Button
              appearance="solid"
              tone="accent"
              accessibilityLabel={t('login.signInButton')}
              onPress={() => openAccountDialog()}
            >
              {t('login.signInButton')}
            </Button>
          </>
        )}
        {accept.isError ? (
          <Text accessibilityRole="alert" className="text-sm text-destructive text-center">
            {apiErrorMessage(accept.error, t('workspace.acceptInvite.failed'))}
          </Text>
        ) : null}
      </View>
    );
  }

  return (
    <View
      className="flex-1 bg-background items-center justify-center px-6"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      <View className="w-full max-w-md items-center">{body}</View>
    </View>
  );
}
