import * as React from 'react';
import { Linking } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useDialogControl } from '@oxy.so/bloom/dialog';
import { RiAddLine } from '@oxy.so/bloom/icons/RiAddLine';
import { RiFileTextLine } from '@oxy.so/bloom/icons/RiFileTextLine';
import { RiLogoutBoxRLine } from '@oxy.so/bloom/icons/RiLogoutBoxRLine';
import { RiNotification3Line } from '@oxy.so/bloom/icons/RiNotification3Line';
import { RiSettings3Line } from '@oxy.so/bloom/icons/RiSettings3Line';
import { RiShieldCheckLine } from '@oxy.so/bloom/icons/RiShieldCheckLine';
import { RiUserLine } from '@oxy.so/bloom/icons/RiUserLine';
import type { SidebarAccount, SidebarAvatar, SidebarTeam } from '@oxy.so/bloom/sidebar';
import { useOxy } from '@oxy.so/services/ui/client';
import { useNiloSettings } from '@/components/settings/settings-provider';
import { CreateWorkspaceModal } from '@/components/workspace/create-workspace-modal';
import { roleLabel } from '@/components/workspace/role-labels';
import { useTranslation } from '@/hooks/useTranslation';
import { releaseDevice, signOutOfDevice } from '@/lib/account-boundary';
import { useUnreadCount } from '@/lib/hooks/use-notifications';
import { useWorkspaces, type Workspace } from '@/lib/hooks/use-workspaces';
import { useWorkspaceStore } from '@/lib/stores/workspace-store';

const TERMS_URL = 'https://oxy.so/company/transparency/policies/terms-of-service';
const PRIVACY_URL = 'https://oxy.so/company/transparency/policies/privacy';

function initial(name: string | undefined): string {
  return (name?.trim()[0] ?? '?').toUpperCase();
}

/**
 * The open workspace: the persisted one, else the personal workspace, else the
 * first. Once the list loads, the persisted id follows it, so the page tree and
 * the page routes always have a real `currentWorkspaceId` (a deleted or
 * unreachable one falls back to the personal workspace).
 */
export function useActiveWorkspace(): {
  workspaces: Workspace[] | undefined;
  active: Workspace | null;
} {
  const { data: workspaces } = useWorkspaces();
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const setCurrentWorkspaceId = useWorkspaceStore((s) => s.setCurrentWorkspaceId);
  const active = React.useMemo<Workspace | null>(() => {
    if (!workspaces?.length) return null;
    return (
      workspaces.find((w) => w.id === currentWorkspaceId) ??
      workspaces.find((w) => w.isPersonal) ??
      workspaces[0] ??
      null
    );
  }, [workspaces, currentWorkspaceId]);
  React.useEffect(() => {
    if (active && active.id !== currentWorkspaceId) setCurrentWorkspaceId(active.id);
  }, [active, currentWorkspaceId, setCurrentWorkspaceId]);
  return { workspaces, active };
}

/**
 * The workspace switcher, heading the sidebar (`teamPlacement="header"`): the
 * open workspace, then every workspace to switch to — its role, or "Personal"
 * for one's own — and "New workspace". A workspace is a squircle, so it reads
 * apart from the people beside it.
 */
export function useWorkspaceTeam(): { team: SidebarTeam | undefined; dialogs: React.ReactNode } {
  const { t } = useTranslation();
  const { user } = useOxy();
  const { workspaces, active } = useActiveWorkspace();
  const setCurrentWorkspaceId = useWorkspaceStore((s) => s.setCurrentWorkspaceId);
  const createDialog = useDialogControl();

  const team = React.useMemo<SidebarTeam | undefined>(() => {
    if (!workspaces) return undefined;
    const avatar = (workspace: Workspace): SidebarAvatar => ({
      // One's own personal workspace without a picture wears its owner's face.
      source:
        workspace.avatar ??
        (workspace.isPersonal && user && workspace.ownerId === user.id ? user.avatar : undefined) ??
        undefined,
      initials: initial(workspace.name),
      shape: 'squircle',
    });
    const create = {
      id: 'create',
      items: [
        {
          key: 'create',
          label: t('workspace.create.title'),
          icon: RiAddLine,
          onPress: () => createDialog.open(),
        },
      ],
    };
    if (!active) {
      return {
        name: t('workspace.switcher.createFirst'),
        avatar: { initials: '+', shape: 'squircle' },
        groups: [create],
        menuLabel: t('workspace.switcher.createFirst'),
      };
    }
    return {
      name: active.name,
      avatar: avatar(active),
      menuLabel: t('workspace.switcher.switchLabel', { name: active.name }),
      groups: [
        {
          id: 'workspaces',
          label: t('workspace.switcher.yourWorkspaces'),
          selection: 'single',
          items: workspaces.map((workspace) => ({
            key: workspace.id,
            label: workspace.name,
            description: workspace.isPersonal
              ? t('workspace.switcher.personal')
              : workspace.role
                ? roleLabel(workspace.role)
                : undefined,
            avatar: avatar(workspace),
            selected: workspace.id === active.id,
            onPress: () => setCurrentWorkspaceId(workspace.id),
          })),
        },
        create,
      ],
    };
  }, [workspaces, active, user, t, createDialog, setCurrentWorkspaceId]);

  const dialogs = (
    <CreateWorkspaceModal
      control={createDialog}
      onCreated={(workspace: Workspace) => setCurrentWorkspaceId(workspace.id)}
    />
  );
  return { team, dialogs };
}

/**
 * The signed-in person, as the card at the sidebar's foot: their account,
 * notifications (with the unread count), settings, the legal pages and sign
 * out.
 */
export function useAccountIdentity(): SidebarAccount | undefined {
  const { t } = useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, isAuthenticated, logout, showBottomSheet } = useOxy();
  const { open: openSettings } = useNiloSettings();
  const { data: unread } = useUnreadCount();
  const unreadCount = unread?.count ?? 0;

  const signOut = React.useCallback(async () => {
    // Push stops first: telling the API needs the session.
    await releaseDevice();
    logout();
    router.replace('/(app)');
    // What the device kept for this account goes with it, and whatever is
    // written while the app unmounts goes at the next sign-in
    // (lib/account-boundary.ts).
    void signOutOfDevice(queryClient);
  }, [logout, router, queryClient]);

  return React.useMemo<SidebarAccount | undefined>(() => {
    if (!isAuthenticated || !user) return undefined;
    const name = user.name?.first
      ? user.name.last
        ? `${user.name.first} ${user.name.last}`
        : user.name.first
      : user.username || t('common.user');
    return {
      name,
      email: user.username ? `${user.username}@oxy.so` : undefined,
      // A bare Oxy file id: the resolver mounted in the root layout turns it into a URL.
      avatar: { source: user.avatar ?? undefined, initials: initial(name) },
      menuLabel: t('sidebar.accountMenu'),
      groups: [
        {
          id: 'account',
          items: [
            {
              key: 'account',
              label: t('sidebar.account'),
              icon: RiUserLine,
              onPress: () => showBottomSheet?.('ManageAccount'),
            },
            {
              key: 'notifications',
              label: t('sidebar.notifications'),
              icon: RiNotification3Line,
              badge: unreadCount > 0 ? unreadCount : undefined,
              onPress: () => router.push('/(app)/notifications'),
            },
            {
              key: 'settings',
              label: t('sidebar.settings'),
              icon: RiSettings3Line,
              onPress: () => openSettings(),
            },
          ],
        },
        {
          id: 'legal',
          items: [
            {
              key: 'terms',
              label: t('sidebar.termsOfService'),
              icon: RiFileTextLine,
              onPress: () => void Linking.openURL(TERMS_URL),
            },
            {
              key: 'privacy',
              label: t('sidebar.privacyPolicy'),
              icon: RiShieldCheckLine,
              onPress: () => void Linking.openURL(PRIVACY_URL),
            },
          ],
        },
        {
          id: 'session',
          items: [
            {
              key: 'sign-out',
              label: t('sidebar.logOut'),
              icon: RiLogoutBoxRLine,
              tone: 'destructive',
              onPress: () => void signOut(),
            },
          ],
        },
      ],
    };
  }, [isAuthenticated, user, t, unreadCount, showBottomSheet, router, openSettings, signOut]);
}

export { PRIVACY_URL, TERMS_URL };
