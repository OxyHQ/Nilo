import { PublishSection } from './publish-section';
import React from 'react';
import { View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { RiFileCopyLine } from '@oxy.so/bloom/icons/RiFileCopyLine';
import { RiLinkM } from '@oxy.so/bloom/icons/RiLinkM';
import { RiDeleteBin6Line } from '@oxy.so/bloom/icons/RiDeleteBin6Line';
import { RiArrowDownSLine } from '@oxy.so/bloom/icons/RiArrowDownSLine';
import { Button } from '@oxy.so/bloom/button';
import { Dialog, type DialogControlProps } from '@oxy.so/bloom/dialog';
import { Divider } from '@oxy.so/bloom/divider';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@oxy.so/bloom/dropdown-menu';
import { EmptyState } from '@oxy.so/bloom/empty-state';
import { Loading } from '@oxy.so/bloom/loading';
import { Switch } from '@oxy.so/bloom/switch';
import { toast } from '@oxy.so/bloom/toast';
import { Text } from '@oxy.so/bloom/typography';
import { MONO_FONT_FAMILY } from '@/lib/fonts';
import { useColorScheme } from '@/lib/useColorScheme';
import {
  useShareLinks,
  useCreateShareLink,
  useRevokeShareLink,
  SHARE_LINK_SCOPES,
  type ShareLink,
  type ShareLinkScope,
} from '@/lib/hooks/use-share-links';
import { buildShareUrl } from './build-share-url';
import { useTranslation } from '@/hooks/useTranslation';
import i18n from '@/lib/i18n';
import { usePagePermissions } from '@/lib/hooks/use-page-permissions';
import { hasRole } from '@/lib/hooks/workspace-roles';
import { PeopleSection } from './people-section';
import { GeneralAccess } from './general-access';

/** Resolved at call time so the label follows the active locale. */
function scopeLabel(scope: ShareLinkScope): string {
  switch (scope) {
    case 'read':
      return i18n.t('sharing.scopes.read.label');
    case 'comment':
      return i18n.t('sharing.scopes.comment.label');
    case 'edit':
      return i18n.t('sharing.scopes.edit.label');
  }
}

function scopeDescription(scope: ShareLinkScope): string {
  switch (scope) {
    case 'read':
      return i18n.t('sharing.scopes.read.description');
    case 'comment':
      return i18n.t('sharing.scopes.comment.description');
    case 'edit':
      return i18n.t('sharing.scopes.edit.description');
  }
}

function isExpired(link: ShareLink): boolean {
  if (!link.expiresAt) return false;
  return new Date(link.expiresAt).getTime() < Date.now();
}

function formatExpiry(expiresAt: string | null): string {
  if (!expiresAt) return i18n.t('sharing.expiry.never');
  try {
    const date = new Date(expiresAt);
    return i18n.t('sharing.expiry.expires', { date: date.toLocaleString() });
  } catch {
    return i18n.t('sharing.expiry.hasExpiry');
  }
}

interface ExistingLinkRowProps {
  link: ShareLink;
  pageId: string;
}

function ExistingLinkRow({ link, pageId }: ExistingLinkRowProps) {
  const { colors } = useColorScheme();
  const { t } = useTranslation();
  const { mutate: revoke, isPending: isRevoking } = useRevokeShareLink(pageId);
  const url = buildShareUrl(link.token);
  const expired = isExpired(link);

  const handleCopy = React.useCallback(async () => {
    await Clipboard.setStringAsync(url);
    toast.success(t('sharing.toasts.copied'));
  }, [url, t]);

  const handleRevoke = React.useCallback(() => {
    revoke(link.id, {
      onSuccess: () => toast.success(t('sharing.toasts.revoked')),
      onError: (err) => {
        const message =
          err instanceof Error && err.message ? err.message : t('sharing.toasts.revokeFailed');
        toast.error(message);
      },
    });
  }, [revoke, link.id, t]);

  return (
    <View className="flex-row items-center gap-2 px-2 py-2 rounded-lg">
      <RiLinkM width={14} height={14} fill={colors.mutedForeground} />
      <View className="flex-1 min-w-0">
        <Text
          className="text-xs text-foreground"
          style={MONO_STYLE}
          numberOfLines={1}
          ellipsizeMode="middle"
        >
          {url}
        </Text>
        <Text className="text-[11px] text-muted-foreground">
          {scopeLabel(link.scope)} · {formatExpiry(link.expiresAt)}
          {expired ? ` · ${t('sharing.expiry.expired')}` : ''}
        </Text>
      </View>
      <Button
        appearance="subtle"
        size="sm"
        iconOnly
        onPress={handleCopy}
        accessibilityLabel={t('sharing.links.copy')}
        leadingIcon={RiFileCopyLine}
      />
      <Button
        appearance="subtle"
        tone="danger"
        size="sm"
        iconOnly
        onPress={handleRevoke}
        disabled={isRevoking}
        loading={isRevoking}
        accessibilityLabel={t('sharing.links.revoke')}
        leadingIcon={RiDeleteBin6Line}
      />
    </View>
  );
}

/** Bloom's `Text` sets Inter inline, which outranks a `font-mono` class. */
const MONO_STYLE = { fontFamily: MONO_FONT_FAMILY };

interface ShareModalProps {
  control: DialogControlProps;
  pageId: string;
}

export function ShareModal({ control, pageId }: ShareModalProps) {
  const { t } = useTranslation();
  return (
    <Dialog
      control={control}
      placement={{ base: 'bottom', md: 'center' }}
      title={t('sharing.modal.title')}
      description={t('sharing.modal.description')}
    >
      <ShareModalBody pageId={pageId} onNavigate={() => control.close()} />
    </Dialog>
  );
}

/** Mounted only while the dialog is open, so its queries run only then. */
function ShareModalBody({ pageId, onNavigate }: { pageId: string; onNavigate: () => void }) {
  const { t } = useTranslation();
  const permissions = usePagePermissions(pageId);
  const canManage = !permissions.isError && hasRole(permissions.data?.role, 'editor');
  const [scope, setScope] = React.useState<ShareLinkScope>('read');
  const {
    data: links,
    isLoading: isListLoading,
    isError,
    error,
  } = useShareLinks(pageId, { enabled: Boolean(pageId) && canManage });
  const { mutate: createLink, isPending: isCreating } = useCreateShareLink(pageId);

  // The API lists active links only.
  const activeLinks = links ?? [];
  const matchingLink = React.useMemo(
    () => activeLinks.find((l) => l.scope === scope && !isExpired(l)) ?? null,
    [activeLinks, scope],
  );

  const isPublic = matchingLink !== null;

  const handleTogglePublic = React.useCallback(
    (next: boolean) => {
      if (next) {
        if (matchingLink) return;
        createLink(
          { scope, expiresAt: null },
          {
            onSuccess: async (link) => {
              const url = buildShareUrl(link.token);
              await Clipboard.setStringAsync(url);
              toast.success(t('sharing.toasts.created'));
            },
            onError: (err) => {
              const message =
                err instanceof Error && err.message
                  ? err.message
                  : t('sharing.toasts.createFailed');
              toast.error(message);
            },
          },
        );
      } else {
        toast(t('sharing.toasts.useRevoke'));
      }
    },
    [createLink, matchingLink, scope, t],
  );

  const handleCopyActive = React.useCallback(async () => {
    if (!matchingLink) return;
    await Clipboard.setStringAsync(buildShareUrl(matchingLink.token));
    toast.success(t('sharing.toasts.copied'));
  }, [matchingLink, t]);

  return (
    <View className="gap-3">
      <PublishSection pageId={pageId} />
      {permissions.isLoading ? (
        <Loading variant="spinner" size="sm" />
      ) : permissions.isError ? (
        <View className="gap-2">
          <Text accessibilityRole="alert" className="text-sm text-destructive">
            {t('sharing.people.loadFailed')}
          </Text>
          <Button
            appearance="outline"
            onPress={() => permissions.refetch()}
            accessibilityLabel={t('sharing.people.retry')}
          >
            {t('sharing.people.retry')}
          </Button>
        </View>
      ) : permissions.data ? (
        <>
          <PeopleSection permissions={permissions.data} onNavigate={onNavigate} />
          <GeneralAccess permissions={permissions.data} onNavigate={onNavigate} />
        </>
      ) : null}
      {canManage ? (
        <>
          <View className="rounded-xl border border-border p-3 gap-2">
            <View className="flex-row items-center justify-between gap-3">
              <View className="flex-1 min-w-0">
                <Text variant="body-semibold">{t('sharing.modal.anyoneWithLink')}</Text>
                <Text className="text-xs text-muted-foreground">
                  {isPublic
                    ? t('sharing.modal.publicActive', { scope: scopeLabel(scope) })
                    : t('sharing.modal.publicInactive')}
                </Text>
              </View>
              <Switch
                checked={isPublic}
                onCheckedChange={handleTogglePublic}
                disabled={isCreating}
                accessibilityLabel={t('sharing.modal.anyoneWithLink')}
              />
            </View>

            <Text className="text-xs text-muted-foreground">
              {t('sharing.modal.guestExplanation')}
            </Text>
            <View className="flex-row items-center gap-2">
              <Text className="text-xs text-muted-foreground">{t('sharing.modal.access')}</Text>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    appearance="outline"
                    size="sm"
                    accessibilityLabel={t('sharing.modal.selectedScope', {
                      scope: scopeLabel(scope),
                    })}
                    trailingIcon={RiArrowDownSLine}
                  >
                    {scopeLabel(scope)}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  {SHARE_LINK_SCOPES.map((option) => (
                    <DropdownMenuItem key={option} onPress={() => setScope(option)}>
                      <View className="gap-0.5">
                        <Text variant="body-medium">{scopeLabel(option)}</Text>
                        <Text className="text-xs text-muted-foreground">
                          {scopeDescription(option)}
                        </Text>
                      </View>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </View>

            {isPublic && matchingLink ? (
              <View className="flex-row items-center gap-2 mt-1">
                <View className="flex-1 min-w-0 rounded-lg border border-border bg-muted/30 px-2 py-1.5">
                  <Text
                    className="text-xs text-foreground"
                    style={MONO_STYLE}
                    numberOfLines={1}
                    ellipsizeMode="middle"
                  >
                    {buildShareUrl(matchingLink.token)}
                  </Text>
                </View>
                <Button
                  size="sm"
                  onPress={handleCopyActive}
                  accessibilityLabel={t('sharing.modal.copy')}
                  leadingIcon={RiFileCopyLine}
                >
                  {t('sharing.modal.copy')}
                </Button>
              </View>
            ) : null}
          </View>

          <View className="gap-1">
            <Text className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {t('sharing.modal.existingLinks')}
            </Text>
            {isListLoading ? (
              <View className="py-4 items-center">
                <Loading variant="spinner" size="sm" />
              </View>
            ) : isError ? (
              <Text className="text-sm text-destructive">
                {error instanceof Error ? error.message : t('sharing.modal.loadFailed')}
              </Text>
            ) : activeLinks.length === 0 ? (
              <EmptyState
                variant="compact"
                // icon: Link2
                title={t('sharing.modal.empty')}
              />
            ) : (
              <View className="rounded-lg border border-border bg-card overflow-hidden">
                {activeLinks.map((link, idx) => (
                  <View key={link.id}>
                    {idx > 0 ? (
                      <View className="mx-2">
                        <Divider />
                      </View>
                    ) : null}
                    <ExistingLinkRow link={link} pageId={pageId} />
                  </View>
                ))}
              </View>
            )}
          </View>
        </>
      ) : null}
    </View>
  );
}
