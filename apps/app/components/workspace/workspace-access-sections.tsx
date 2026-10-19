/**
 * Settings › Members, below the member list: the join link, the invitations
 * waiting for an Oxy account, and the workspace's guests (people pages are
 * shared with who are not members). Admins and owners only.
 */
import React from 'react';
import { View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { Avatar } from '@oxy.so/bloom/avatar';
import { Button } from '@oxy.so/bloom/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@oxy.so/bloom/dropdown-menu';
import { RiFileCopyLine } from '@oxy.so/bloom/icons/RiFileCopyLine';
import { RiMoreLine } from '@oxy.so/bloom/icons/RiMoreLine';
import { Loading } from '@oxy.so/bloom/loading';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemText,
  SelectTrigger,
  SelectValue,
} from '@oxy.so/bloom/select';
import { SettingsCard, SettingsRow, SettingsSection } from '@oxy.so/bloom/settings-modal/modal';
import { confirm } from '@oxy.so/bloom/surfaces';
import { Switch } from '@oxy.so/bloom/switch';
import { toast } from '@oxy.so/bloom/toast';
import { Text } from '@oxy.so/bloom/typography';
import { IconDisplay } from '@/components/page-chrome/icon-display';
import { useNiloSettings } from '@/components/settings/settings-provider';
import { useTranslation } from '@/hooks/useTranslation';
import { apiErrorMessage } from '@/lib/api/error-message';
import { memberProfileName } from '@/lib/hooks/use-workspace-members';
import {
  INVITE_LINK_ROLES,
  type InviteLinkRole,
  type WorkspaceGuest,
  type WorkspaceInvite,
  useInviteLink,
  usePendingInvites,
  useRemoveGuest,
  useRevokeInvite,
  useUpdateInviteLink,
  useWorkspaceGuests,
} from '@/lib/hooks/use-workspace-admin';
import { cn } from '@/lib/utils';
import { roleLabel } from './role-labels';

interface SectionProps {
  workspaceId: string;
}

/** The workspace's join link: on or off, the role it gives, copy and regenerate. */
export function InviteLinkSection({ workspaceId }: SectionProps) {
  const { t } = useTranslation();
  const { data: link, isLoading } = useInviteLink(workspaceId);
  const update = useUpdateInviteLink(workspaceId);
  const [role, setRole] = React.useState<InviteLinkRole>('editor');
  const shownRole = link?.role ?? role;
  const roles = INVITE_LINK_ROLES.map((value) => ({ value, label: roleLabel(value) }));

  const fail = (error: unknown) =>
    toast.error(apiErrorMessage(error, t('workspace.inviteLink.failed')));

  const toggle = (on: boolean) =>
    update.mutate(on ? { action: 'create', role: shownRole } : { action: 'disable' }, {
      onError: fail,
    });

  const changeRole = (next: InviteLinkRole) => {
    setRole(next);
    if (link) update.mutate({ action: 'role', role: next }, { onError: fail });
  };

  const copy = async () => {
    if (!link) return;
    await Clipboard.setStringAsync(link.url);
    toast.success(t('workspace.inviteLink.copied'));
  };

  const regenerate = async () => {
    const confirmed = await confirm({
      title: t('workspace.inviteLink.regenerateTitle'),
      description: t('workspace.inviteLink.regenerateDescription'),
      confirmLabel: t('workspace.inviteLink.regenerate'),
      destructive: true,
    });
    if (!confirmed) return;
    update.mutate(
      { action: 'create', role: shownRole },
      { onSuccess: () => toast.success(t('workspace.inviteLink.regenerated')), onError: fail },
    );
  };

  return (
    <SettingsSection
      label={t('workspace.inviteLink.title')}
      description={t('workspace.inviteLink.description')}
    >
      <SettingsCard>
        <SettingsRow label={t('workspace.inviteLink.enable')}>
          {isLoading ? (
            <Loading variant="spinner" accessibilityLabel={t('common.loading')} />
          ) : (
            <Switch
              checked={Boolean(link)}
              onCheckedChange={toggle}
              disabled={update.isPending}
              accessibilityLabel={t('workspace.inviteLink.enable')}
            />
          )}
        </SettingsRow>
        <SettingsRow label={t('workspace.inviteLink.role')}>
          <Select
            size="sm"
            value={shownRole}
            disabled={update.isPending}
            onValueChange={(value) => {
              const next = INVITE_LINK_ROLES.find((option) => option === value);
              if (next) changeRole(next);
            }}
          >
            <SelectTrigger label={t('workspace.inviteLink.role')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent
              items={roles}
              renderItem={(item) => (
                <SelectItem value={item.value} label={item.label}>
                  <SelectItemText>{item.label}</SelectItemText>
                </SelectItem>
              )}
            />
          </Select>
        </SettingsRow>
        {link ? (
          <View className="flex-row items-center gap-2 py-2.5 pr-2.5">
            <Text className="flex-1 text-xs text-muted-foreground" numberOfLines={1} selectable>
              {link.url}
            </Text>
            <Button
              appearance="plain"
              tone="neutral"
              size="sm"
              leadingIcon={RiFileCopyLine}
              onPress={copy}
              accessibilityLabel={t('workspace.inviteLink.copy')}
            >
              {t('workspace.inviteLink.copy')}
            </Button>
            <Button
              appearance="plain"
              tone="neutral"
              size="sm"
              disabled={update.isPending}
              onPress={regenerate}
              accessibilityLabel={t('workspace.inviteLink.regenerate')}
            >
              {t('workspace.inviteLink.regenerate')}
            </Button>
          </View>
        ) : null}
      </SettingsCard>
    </SettingsSection>
  );
}

function InviteRow({
  invite,
  workspaceId,
  last,
}: {
  invite: WorkspaceInvite;
  workspaceId: string;
  last: boolean;
}) {
  const { t } = useTranslation();
  const revoke = useRevokeInvite(workspaceId);
  return (
    <View
      className={cn(
        'min-h-[52px] flex-row items-center gap-3 py-2.5 pr-2.5',
        last ? '' : 'border-b border-border',
      )}
    >
      <Avatar name={invite.email} size={32} />
      <View className="flex-1 min-w-0">
        <Text variant="body-medium" numberOfLines={1}>
          {invite.email}
        </Text>
        <Text className="text-xs text-muted-foreground" numberOfLines={1}>
          {invite.expired
            ? t('workspace.pendingInvites.expired')
            : t('workspace.pendingInvites.waiting', { role: roleLabel(invite.role) })}
        </Text>
      </View>
      <Button
        appearance="plain"
        tone="neutral"
        size="sm"
        disabled={revoke.isPending}
        accessibilityLabel={t('workspace.pendingInvites.revokeFor', { email: invite.email })}
        onPress={() =>
          revoke.mutate(invite.id, {
            onSuccess: () =>
              toast.success(t('workspace.pendingInvites.revoked', { email: invite.email })),
            onError: (error) =>
              toast.error(apiErrorMessage(error, t('workspace.pendingInvites.revokeFailed'))),
          })
        }
      >
        {t('workspace.pendingInvites.revoke')}
      </Button>
    </View>
  );
}

/** Invitations by email still waiting for someone to sign up to Oxy with that email. */
export function PendingInvitesSection({ workspaceId }: SectionProps) {
  const { t } = useTranslation();
  const { data: invites } = usePendingInvites(workspaceId);
  if (!invites || invites.length === 0) return null;
  return (
    <SettingsSection
      label={t('workspace.pendingInvites.title', { count: invites.length })}
      description={t('workspace.pendingInvites.description')}
    >
      <SettingsCard>
        {invites.map((invite, idx) => (
          <InviteRow
            key={invite.id}
            invite={invite}
            workspaceId={workspaceId}
            last={idx === invites.length - 1}
          />
        ))}
      </SettingsCard>
    </SettingsSection>
  );
}

function GuestRow({
  guest,
  workspaceId,
  last,
}: {
  guest: WorkspaceGuest;
  workspaceId: string;
  last: boolean;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { afterClose, close } = useNiloSettings();
  const remove = useRemoveGuest(workspaceId);
  const name = memberProfileName(guest) ?? guest.userId;

  const handleRemove = async () => {
    const confirmed = await confirm({
      title: t('workspace.guests.removeTitle', { name }),
      description: t('workspace.guests.removeDescription', { count: guest.pages.length }),
      confirmLabel: t('workspace.guests.remove'),
      destructive: true,
    });
    if (!confirmed) return;
    remove.mutate(guest.userId, {
      onSuccess: () => toast.success(t('workspace.guests.removed', { name })),
      onError: (error) => toast.error(apiErrorMessage(error, t('workspace.guests.removeFailed'))),
    });
  };

  const openPage = (pageId: string) => {
    afterClose(() => router.push(`/p/${pageId}`));
    close();
  };

  return (
    <View
      className={cn('gap-1.5 py-2.5 pr-2.5', last ? '' : 'border-b border-border')}
      accessibilityLabel={name}
    >
      <View className="flex-row items-center gap-3">
        <Avatar source={guest.user?.avatar ?? undefined} name={name} size={32} />
        <View className="flex-1 min-w-0">
          <Text variant="body-medium" numberOfLines={1}>
            {name}
          </Text>
          {guest.user?.email ? (
            <Text className="text-xs text-muted-foreground" numberOfLines={1}>
              {guest.user.email}
            </Text>
          ) : null}
        </View>
        <DropdownMenu>
          <DropdownMenuTrigger
            asChild
            label={t('workspace.members.moreActions', { name })}
            disabled={remove.isPending}
          >
            <Button
              appearance="plain"
              tone="neutral"
              size="sm"
              icon={RiMoreLine}
              accessibilityLabel={t('workspace.members.moreActions', { name })}
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem tone="danger" onPress={handleRemove}>
              {t('workspace.guests.remove')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </View>
      <View className="ml-11 gap-0.5">
        {guest.pages.map((page) => {
          const title = page.title.trim() || t('pages.untitled');
          return (
            <Button
              key={page.pageId}
              appearance="plain"
              tone="neutral"
              size="xs"
              onPress={() => openPage(page.pageId)}
              accessibilityLabel={t('pages.openPage', { title })}
              className="self-start"
            >
              <View className="flex-row items-center gap-1.5">
                <IconDisplay value={page.icon} size={13} showPlaceholder pageId={page.pageId} />
                <Text className="text-xs text-foreground" numberOfLines={1}>
                  {title}
                </Text>
                <Text className="text-xs text-muted-foreground">· {roleLabel(page.role)}</Text>
              </View>
            </Button>
          );
        })}
      </View>
    </View>
  );
}

/** People pages are shared with who are not members, with what they can open. */
export function GuestsSection({ workspaceId }: SectionProps) {
  const { t } = useTranslation();
  const { data: guests, isLoading, isError, error } = useWorkspaceGuests(workspaceId);
  return (
    <SettingsSection
      label={t('workspace.guests.title', { count: guests?.length ?? 0 })}
      description={t('workspace.guests.description')}
    >
      <SettingsCard>
        {isLoading ? (
          <View className="py-6 items-center justify-center">
            <Loading variant="spinner" accessibilityLabel={t('common.loading')} />
          </View>
        ) : isError ? (
          <SettingsRow label={apiErrorMessage(error, t('workspace.guests.loadFailed'))} />
        ) : !guests || guests.length === 0 ? (
          <SettingsRow label={t('workspace.guests.empty')} />
        ) : (
          guests.map((guest, idx) => (
            <GuestRow
              key={guest.userId}
              guest={guest}
              workspaceId={workspaceId}
              last={idx === guests.length - 1}
            />
          ))
        )}
      </SettingsCard>
    </SettingsSection>
  );
}
