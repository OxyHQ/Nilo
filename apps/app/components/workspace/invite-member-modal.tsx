import React from 'react';
import { View, Pressable, Platform } from 'react-native';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import * as DropdownMenu from '@/components/ui/dropdown-menu';
import { ChevronDown } from 'lucide-react-native';
import axios from 'axios';
import { toast } from '@oxy.so/bloom/toast';
import { useColorScheme } from '@/lib/useColorScheme';
import { useInviteMember } from '@/lib/hooks/use-workspace-members';
import { roleDescription, roleLabel } from './role-labels';
import { useTranslation } from '@/hooks/useTranslation';
import i18n from '@/lib/i18n';
import type { WorkspaceRole } from '@/lib/hooks/use-workspaces';

const ASSIGNABLE_ROLES: WorkspaceRole[] = ['viewer', 'commenter', 'editor', 'admin'];

// RFC-5322 compliant-ish minimum: localpart@domain.tld with no whitespace.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface InviteMemberModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
}

function extractErrorMessage(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { message?: string; error?: string } | undefined;
    if (data?.message) return data.message;
    if (data?.error) return data.error;
    if (err.response?.status === 404) {
      return i18n.t('workspace.invite.userNotFound');
    }
    if (err.response?.status === 409) {
      return i18n.t('workspace.invite.alreadyMember');
    }
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

export function InviteMemberModal({ open, onOpenChange, workspaceId }: InviteMemberModalProps) {
  const { colors } = useColorScheme();
  const { t } = useTranslation();
  const [email, setEmail] = React.useState('');
  const [role, setRole] = React.useState<WorkspaceRole>('editor');
  const { mutate, isPending } = useInviteMember(workspaceId);

  React.useEffect(() => {
    if (!open) {
      setEmail('');
      setRole('editor');
    }
  }, [open]);

  const trimmedEmail = email.trim();
  const emailValid = EMAIL_REGEX.test(trimmedEmail);
  const canSubmit = emailValid && !isPending;

  const handleSubmit = React.useCallback(() => {
    if (!canSubmit) return;
    mutate(
      { email: trimmedEmail, role },
      {
        onSuccess: () => {
          toast.success(
            t('workspace.invite.invited', { email: trimmedEmail, role: roleLabel(role) }),
          );
          onOpenChange(false);
        },
        onError: (err) => {
          toast.error(extractErrorMessage(err, t('workspace.invite.failed')));
        },
      },
    );
  }, [canSubmit, mutate, trimmedEmail, role, onOpenChange, t]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('workspace.invite.title')}</DialogTitle>
          <DialogDescription>{t('workspace.invite.description')}</DialogDescription>
        </DialogHeader>

        <View className="gap-3">
          <View className="gap-1.5">
            <Text className="text-sm font-medium text-foreground">
              {t('workspace.invite.email')}
            </Text>
            <Input
              value={email}
              onChangeText={setEmail}
              placeholder={t('workspace.invite.emailPlaceholder')}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              onSubmitEditing={handleSubmit}
              returnKeyType="send"
            />
            {email.length > 0 && !emailValid ? (
              <Text className="text-xs text-destructive">{t('workspace.invite.invalidEmail')}</Text>
            ) : null}
          </View>

          <View className="gap-1.5">
            <Text className="text-sm font-medium text-foreground">
              {t('workspace.invite.role')}
            </Text>
            <DropdownMenu.Root>
              <DropdownMenu.Trigger>
                <Pressable
                  className="h-9 flex-row items-center justify-between rounded-xl border border-input bg-background px-3"
                  accessibilityRole="button"
                  accessibilityLabel={t('workspace.invite.selectedRole', { role: roleLabel(role) })}
                  disabled={isPending}
                >
                  <View className="flex-1 min-w-0">
                    <Text className="text-sm text-foreground" numberOfLines={1}>
                      {roleLabel(role)}
                    </Text>
                  </View>
                  <ChevronDown size={14} color={colors.mutedForeground} />
                </Pressable>
              </DropdownMenu.Trigger>
              <DropdownMenu.Content>
                {ASSIGNABLE_ROLES.map((option) => (
                  <DropdownMenu.Item key={option} onSelect={() => setRole(option)}>
                    {Platform.OS === 'web' ? (
                      <View className="gap-0.5">
                        <Text className="text-sm font-medium text-foreground">
                          {roleLabel(option)}
                        </Text>
                        <Text className="text-xs text-muted-foreground">
                          {roleDescription(option)}
                        </Text>
                      </View>
                    ) : (
                      <>
                        <DropdownMenu.ItemTitle>{roleLabel(option)}</DropdownMenu.ItemTitle>
                        <DropdownMenu.ItemSubtitle>
                          {roleDescription(option)}
                        </DropdownMenu.ItemSubtitle>
                      </>
                    )}
                  </DropdownMenu.Item>
                ))}
              </DropdownMenu.Content>
            </DropdownMenu.Root>
            <Text className="text-xs text-muted-foreground">{roleDescription(role)}</Text>
          </View>
        </View>

        <DialogFooter>
          <Button variant="outline" onPress={() => onOpenChange(false)} disabled={isPending}>
            <Text>{t('common.cancel')}</Text>
          </Button>
          <Button onPress={handleSubmit} disabled={!canSubmit} isLoading={isPending}>
            <Text>{t('workspace.invite.submit')}</Text>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
