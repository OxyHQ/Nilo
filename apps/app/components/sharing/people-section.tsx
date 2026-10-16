import { useState } from 'react';
import { View } from 'react-native';
import { useOxy } from '@oxy.so/services';
import { useRouter } from 'expo-router';
import axios from 'axios';
import { Avatar } from '@oxy.so/bloom/avatar';
import { Button, LinkButton } from '@oxy.so/bloom/button';
import { EmptyState } from '@oxy.so/bloom/empty-state';
import { TextFieldInput } from '@oxy.so/bloom/text-field';
import { Text } from '@oxy.so/bloom/typography';
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
    <LinkButton
      accessibilityRole="link"
      accessibilityLabel={label}
      linkTone="secondary"
      underline="rest"
      size="xs"
      onPress={() => {
        onNavigate();
        router.push(`/p/${pageId}`);
      }}
    >
      {label}
    </LinkButton>
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
  const { user } = useOxy();
  const update = useUpdatePageAccess(permissions.pageId);
  const remove = useRemovePageAccess(permissions.pageId);
  const name = memberProfileName(grant) || grant.userId;
  const self = grant.userId === user?.id;
  const editable = canManagePageGrant(permissions.role, grant);
  const canRemove = !grant.inheritedFrom && (self || editable);
  const pending = update.isPending || remove.isPending;
  return (
    <View className="gap-1 py-2">
      <View className="flex-row items-center gap-2">
        <Avatar source={grant.user?.avatar} variant="thumb" name={name} size={32} />
        <View className="flex-1 min-w-0 gap-0.5">
          <Text variant="body-regular" numberOfLines={1}>
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
          <Button
            appearance="plain"
            tone="danger"
            size="sm"
            disabled={pending}
            accessibilityLabel={
              self ? t('sharing.people.leave') : t('sharing.people.removePerson', { name })
            }
            onPress={() => remove.mutate(grant.userId)}
          >
            {self ? t('sharing.people.leave') : t('sharing.people.remove')}
          </Button>
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
            <View className="flex-1 min-w-32">
              <TextFieldInput
                label={t('sharing.people.email')}
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
            </View>
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
              loading={invite.isPending}
              onPress={submit}
            >
              {t('sharing.people.invite')}
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
        <Text variant="body-semibold">{t('sharing.people.title')}</Text>
        {permissions.grants.length === 0 ? (
          <EmptyState
            variant="compact"
            // icon: UserRound
            title={t('sharing.people.empty')}
          />
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
