/**
 * Joining a workspace by a link: which workspace and role it gives, then
 * joining, signed in. An invitation's own link (`accept-invitation.tsx`) and a
 * workspace's invite link (`app/join/[token].tsx`) are this one screen, each
 * worded its own way (`keys`). Signing in or creating an Oxy account happens
 * in the account dialog, and the screen stays put, so the link is used by
 * whichever account that is.
 */
import type React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useOxy } from '@oxy.so/services/ui/client';
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
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
import type { InvitationPreview, JoinWorkspaceResponse } from '@/lib/hooks/use-workspace-admin';
import { useWorkspaceStore } from '@/lib/stores/workspace-store';

export interface InvitationScreenProps {
  token: string | null;
  /** What the link leads to, read before joining. */
  preview: Pick<UseQueryResult<InvitationPreview>, 'data' | 'error' | 'isPending'>;
  /** Joining by the link, with its token. */
  accept: Pick<
    UseMutationResult<JoinWorkspaceResponse, Error, string>,
    'mutate' | 'isPending' | 'isError' | 'error'
  >;
  /** Where the screen's text is: `<keys>.title`, `<keys>.<refusal>Title`… */
  keys: 'workspace.acceptInvite' | 'workspace.join';
  /** Why the link joins nobody, from the API's answer; null when it may. */
  refusalOf: (error: unknown) => string | null;
  /** The refusal after which a signed-in member is offered their workspaces. */
  openAfter?: string;
}

export function InvitationScreen({
  token,
  preview,
  accept,
  keys,
  refusalOf,
  openAfter,
}: InvitationScreenProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isAuthenticated, openAccountDialog } = useOxy();
  const setCurrentWorkspaceId = useWorkspaceStore((s) => s.setCurrentWorkspaceId);

  const error = accept.error ?? preview.error;
  const refusal = token ? refusalOf(error) : 'notFound';
  const name = preview.data?.workspace.name ?? '';

  const handleAccept = () => {
    if (!token) return;
    accept.mutate(token, {
      onSuccess: (result) => {
        toast.success(t(result.joined ? `${keys}.joined` : `${keys}.alreadyMember`, { name }));
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
          title={t(`${keys}.${refusal}Title`)}
          description={t(`${keys}.${refusal}Body`)}
        />
        {refusal === openAfter && isAuthenticated ? (
          <Button
            appearance="outline"
            tone="neutral"
            accessibilityLabel={t(`${keys}.open`)}
            onPress={() => router.replace('/(app)')}
          >
            {t(`${keys}.open`)}
          </Button>
        ) : null}
      </View>
    );
  } else if (preview.isPending) {
    body = <Loading variant="spinner" accessibilityLabel={t('common.loading')} />;
  } else if (!preview.data) {
    body = (
      <EmptyState
        title={t(`${keys}.failed`)}
        description={apiErrorMessage(error, t(`${keys}.failed`))}
      />
    );
  } else {
    body = (
      <View className="items-center gap-4">
        <WorkspaceAvatar workspace={preview.data.workspace} size={56} />
        <Text accessibilityRole="header" variant="title-2-semibold" className="text-center">
          {t(`${keys}.title`, { name })}
        </Text>
        <Text className="text-base text-muted-foreground text-center">
          {t(`${keys}.description`, { name, role: roleLabel(preview.data.role) })}
        </Text>
        {isAuthenticated ? (
          <Button
            appearance="solid"
            tone="accent"
            accessibilityLabel={t(`${keys}.submit`)}
            disabled={accept.isPending}
            loading={accept.isPending}
            onPress={handleAccept}
          >
            {t(`${keys}.submit`)}
          </Button>
        ) : (
          <>
            <Text className="text-sm text-muted-foreground text-center">{t(`${keys}.signIn`)}</Text>
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
            {apiErrorMessage(accept.error, t(`${keys}.failed`))}
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
