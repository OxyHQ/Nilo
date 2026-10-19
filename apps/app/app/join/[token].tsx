/**
 * A workspace's invite link (`/join/<token>`): who it is from and the role
 * it gives, then joining, signed in. Admins make the link in Settings ›
 * Members (`components/workspace/workspace-access-sections.tsx`).
 */
import type React from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
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
import { useInviteLinkPreview, useJoinWorkspace } from '@/lib/hooks/use-workspace-admin';
import { useWorkspaceStore } from '@/lib/stores/workspace-store';

export default function JoinWorkspaceRoute() {
  const { token } = useLocalSearchParams<{ token: string }>();
  return <JoinWorkspace key={token} token={typeof token === 'string' ? token : null} />;
}

function JoinWorkspace({ token }: { token: string | null }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isAuthenticated, openAccountDialog } = useOxy();
  const setCurrentWorkspaceId = useWorkspaceStore((s) => s.setCurrentWorkspaceId);
  const preview = useInviteLinkPreview(token);
  const join = useJoinWorkspace();

  const error = join.error ?? preview.error;
  const status = axios.isAxiosError(error) ? error.response?.status : undefined;
  const name = preview.data?.workspace.name ?? '';

  const handleJoin = () => {
    if (!token) return;
    join.mutate(token, {
      onSuccess: (result) => {
        toast.success(
          t(result.joined ? 'workspace.join.joined' : 'workspace.join.alreadyMember', { name }),
        );
        setCurrentWorkspaceId(result.workspaceId);
        router.replace('/(app)');
      },
    });
  };

  let body: React.ReactNode;
  if (!token || status === 404) {
    body = (
      <EmptyState
        title={t('workspace.join.notFoundTitle')}
        description={t('workspace.join.notFoundBody')}
      />
    );
  } else if (status === 410) {
    body = (
      <EmptyState
        title={t('workspace.join.disabledTitle')}
        description={t('workspace.join.disabledBody')}
      />
    );
  } else if (preview.isPending) {
    body = <Loading variant="spinner" accessibilityLabel={t('common.loading')} />;
  } else if (!preview.data) {
    body = (
      <EmptyState
        title={t('workspace.join.failed')}
        description={apiErrorMessage(error, t('workspace.join.failed'))}
      />
    );
  } else {
    body = (
      <View className="items-center gap-4">
        <WorkspaceAvatar workspace={preview.data.workspace} size={56} />
        <Text accessibilityRole="header" variant="title-2-semibold" className="text-center">
          {t('workspace.join.title', { name })}
        </Text>
        <Text className="text-base text-muted-foreground text-center">
          {t('workspace.join.description', { name, role: roleLabel(preview.data.role) })}
        </Text>
        {isAuthenticated ? (
          <Button
            appearance="solid"
            tone="accent"
            accessibilityLabel={t('workspace.join.submit')}
            disabled={join.isPending}
            loading={join.isPending}
            onPress={handleJoin}
          >
            {t('workspace.join.submit')}
          </Button>
        ) : (
          <>
            <Text className="text-sm text-muted-foreground text-center">
              {t('workspace.join.signIn')}
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
        {join.isError ? (
          <Text accessibilityRole="alert" className="text-sm text-destructive text-center">
            {apiErrorMessage(join.error, t('workspace.join.failed'))}
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
