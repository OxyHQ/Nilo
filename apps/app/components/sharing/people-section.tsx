import { useState } from 'react';
import { View, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { useOxy } from '@oxy.so/services';
import { useRouter } from 'expo-router';
import axios from 'axios';
import { Text } from '@/components/ui/text';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/hooks/useTranslation';
import { usePage } from '@/lib/hooks/use-pages';
import { memberProfileName } from '@/lib/hooks/use-workspace-members';
import { hasRole } from '@/lib/hooks/workspace-roles';
import { canAssignPageRole, canManagePageGrant } from '@/lib/hooks/page-access';
import {
  useSharePageByEmail,
  useUpdatePageAccess,
  useRemovePageAccess,
  type PagePermissions,
  type PageGrant,
  type PageGrantRole,
} from '@/lib/hooks/use-page-permissions';
import { PageRolePicker } from './page-role-picker';

export function InheritedPageLink({
  pageId,
  onNavigate,
}: {
  pageId: string;
  onNavigate: () => void;
}) {
  const { data } = usePage(pageId);
  const { t } = useTranslation();
  const router = useRouter();
  const label = t('sharing.people.inherited', { title: data?.page.title || pageId });
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      onPress={() => {
        onNavigate();
        router.push(`/p/${pageId}`);
      }}
    >
      <Text className="text-xs text-muted-foreground underline">{label}</Text>
    </Pressable>
  );
}

function PersonRow({
  grant,
  permissions,
  onNavigate,
}: {
  grant: PageGrant;
  permissions: PagePermissions;
  onNavigate: () => void;
}) {
  const { t } = useTranslation();
  const { user, oxyServices } = useOxy();
  const update = useUpdatePageAccess(permissions.pageId);
  const remove = useRemovePageAccess(permissions.pageId);
  const name = memberProfileName(grant) || grant.userId;
  const self = grant.userId === user?.id;
  const editable = canManagePageGrant(permissions.role, grant);
  const canRemove = !grant.inheritedFrom && (self || editable);
  const pending = update.isPending || remove.isPending;
  const avatar = grant.user?.avatar
    ? oxyServices.assets.publicUrl(grant.user.avatar, 'thumb')
    : null;
  return (
    <View className="gap-1 py-2">
      <View className="flex-row items-center gap-2">
        <View className="h-8 w-8 rounded-full bg-muted items-center justify-center overflow-hidden">
          {avatar ? (
            <Image source={{ uri: avatar }} style={{ width: 32, height: 32 }} contentFit="cover" />
          ) : (
            <Text className="text-xs font-semibold text-foreground">{name[0]?.toUpperCase()}</Text>
          )}
        </View>
        <View className="flex-1 min-w-0 gap-0.5">
          <Text className="text-sm text-foreground" numberOfLines={1}>
            {name}
            {self ? ` ${t('sharing.people.you')}` : ''}
          </Text>
          {grant.user?.email && grant.user.email !== name ? (
            <Text className="text-xs text-muted-foreground" numberOfLines={1}>
              {grant.user.email}
            </Text>
          ) : null}
          {grant.inheritedFrom ? (
            <InheritedPageLink pageId={grant.inheritedFrom} onNavigate={onNavigate} />
          ) : null}
          {grant.viaShareLink ? (
            <Text className="text-xs text-muted-foreground">{t('sharing.people.viaLink')}</Text>
          ) : null}
        </View>
        {editable ? (
          <PageRolePicker
            role={grant.role}
            callerRole={permissions.role}
            disabled={pending}
            label={t('sharing.people.changeRole', { name })}
            onChange={(role) => update.mutate({ userId: grant.userId, role })}
          />
        ) : (
          <Text className="text-xs text-muted-foreground">{t(`sharing.roles.${grant.role}`)}</Text>
        )}
        {canRemove ? (
          <Pressable
            disabled={pending}
            accessibilityRole="button"
            accessibilityLabel={
              self ? t('sharing.people.leave') : t('sharing.people.removePerson', { name })
            }
            onPress={() => remove.mutate(grant.userId)}
            className="px-2 py-2 rounded-lg hover:bg-muted"
          >
            <Text className="text-xs text-destructive">
              {self ? t('sharing.people.leave') : t('sharing.people.remove')}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {update.isError || remove.isError ? (
        <Text accessibilityRole="alert" className="text-xs text-destructive">
          {t('sharing.people.updateFailed')}
        </Text>
      ) : null}
    </View>
  );
}

export function PeopleSection({
  permissions,
  onNavigate,
}: {
  permissions: PagePermissions;
  onNavigate: () => void;
}) {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<PageGrantRole>('viewer');
  const invite = useSharePageByEmail(permissions.pageId);
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const canManage = hasRole(permissions.role, 'editor');
  const submit = () => {
    if (!valid || invite.isPending || !canAssignPageRole(permissions.role, role)) return;
    invite.mutate({ email: email.trim(), role }, { onSuccess: () => setEmail('') });
  };
  const unknownEmail =
    axios.isAxiosError(invite.error) && invite.error.response?.data?.code === 'USER_NOT_FOUND';
  return (
    <View className="gap-3">
      {canManage ? (
        <View className="gap-2">
          <View className="flex-row items-center gap-2 flex-wrap">
            <Input
              className="flex-1 min-w-32"
              accessibilityLabel={t('sharing.people.email')}
              placeholder={t('sharing.people.email')}
              editable={!invite.isPending}
              value={email}
              onChangeText={(value) => {
                setEmail(value);
                invite.reset();
              }}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              onSubmitEditing={submit}
            />
            <PageRolePicker
              role={role}
              callerRole={permissions.role}
              onChange={setRole}
              label={t('sharing.people.inviteRole')}
              disabled={invite.isPending}
            />
            <Button
              size="sm"
              accessibilityLabel={t('sharing.people.invite')}
              disabled={!valid || invite.isPending || !canAssignPageRole(permissions.role, role)}
              isLoading={invite.isPending}
              onPress={submit}
            >
              <Text>{t('sharing.people.invite')}</Text>
            </Button>
          </View>
          {invite.isError ? (
            <Text accessibilityRole="alert" className="text-xs text-destructive">
              {t(unknownEmail ? 'sharing.people.userNotFound' : 'sharing.people.inviteFailed')}
            </Text>
          ) : null}
          {invite.isSuccess ? (
            <Text accessibilityLiveRegion="polite" className="text-xs text-muted-foreground">
              {t('sharing.people.invited')}
            </Text>
          ) : null}
        </View>
      ) : null}
      <View>
        <Text className="text-sm font-semibold text-foreground">{t('sharing.people.title')}</Text>
        {permissions.grants.length === 0 ? (
          <Text className="text-xs text-muted-foreground py-2">{t('sharing.people.empty')}</Text>
        ) : null}
        {permissions.grants.map((grant) => (
          <PersonRow
            key={grant.userId}
            grant={grant}
            permissions={permissions}
            onNavigate={onNavigate}
          />
        ))}
        {permissions.openToWorkspace ? (
          <Text className="text-xs text-muted-foreground">
            {t('sharing.people.workspaceAccess')}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
