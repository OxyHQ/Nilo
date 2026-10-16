import React from 'react';
import { View } from 'react-native';
import { Button } from '@oxy.so/bloom/button';
import { Dialog, type DialogControlProps } from '@oxy.so/bloom/dialog';
import {
  Select,
  SelectContent,
  SelectIcon,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectTrigger,
  SelectValue,
} from '@oxy.so/bloom/select';
import { TextField, TextFieldHint, TextFieldInput, TextFieldLabel } from '@oxy.so/bloom/text-field';
import axios from 'axios';
import { toast } from '@oxy.so/bloom/toast';
import { useInviteMember } from '@/lib/hooks/use-workspace-members';
import { roleDescription, roleLabel } from './role-labels';
import { useTranslation } from '@/hooks/useTranslation';
import i18n from '@/lib/i18n';
import type { WorkspaceRole } from '@/lib/hooks/use-workspaces';

const ASSIGNABLE_ROLES: WorkspaceRole[] = ['viewer', 'commenter', 'editor', 'admin'];

// RFC-5322 compliant-ish minimum: localpart@domain.tld with no whitespace.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface InviteMemberModalProps {
  /** The caller opens the dialog; it closes itself on cancel and on success. */
  control: DialogControlProps;
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

// A Bloom dialog: it opens from the settings dialog, and only a Bloom overlay
// stacks above that one.
export function InviteMemberModal({ control, workspaceId }: InviteMemberModalProps) {
  const { t } = useTranslation();
  const [email, setEmail] = React.useState('');
  const [role, setRole] = React.useState<WorkspaceRole>('editor');
  const { mutate, isPending } = useInviteMember(workspaceId);

  // Reset form whenever the modal is dismissed.
  const handleClosed = React.useCallback(() => {
    setEmail('');
    setRole('editor');
  }, []);

  const trimmedEmail = email.trim();
  const emailValid = EMAIL_REGEX.test(trimmedEmail);
  const canSubmit = emailValid && !isPending;
  const roles = ASSIGNABLE_ROLES.map((option) => ({ value: option, label: roleLabel(option) }));

  const handleSubmit = React.useCallback(() => {
    if (!canSubmit) return;
    mutate(
      { email: trimmedEmail, role },
      {
        onSuccess: () => {
          toast.success(
            t('workspace.invite.invited', { email: trimmedEmail, role: roleLabel(role) }),
          );
          control.close();
        },
        onError: (err) => {
          toast.error(extractErrorMessage(err, t('workspace.invite.failed')));
        },
      },
    );
  }, [canSubmit, mutate, trimmedEmail, role, control, t]);

  return (
    <Dialog
      control={control}
      onClose={handleClosed}
      placement={{ base: 'bottom', md: 'center' }}
      title={t('workspace.invite.title')}
      description={t('workspace.invite.description')}
    >
      <View className="gap-4">
        <View>
          <TextFieldLabel>{t('workspace.invite.email')}</TextFieldLabel>
          <TextField invalid={email.length > 0 && !emailValid}>
            <TextFieldInput
              label={t('workspace.invite.email')}
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
          </TextField>
          {email.length > 0 && !emailValid ? (
            <TextFieldHint invalid>{t('workspace.invite.invalidEmail')}</TextFieldHint>
          ) : null}
        </View>

        <View>
          <TextFieldLabel>{t('workspace.invite.role')}</TextFieldLabel>
          <Select
            value={role}
            disabled={isPending}
            onValueChange={(value) => {
              const next = ASSIGNABLE_ROLES.find((option) => option === value);
              if (next) setRole(next);
            }}
          >
            <SelectTrigger label={t('workspace.invite.role')}>
              <SelectValue />
              <SelectIcon />
            </SelectTrigger>
            <SelectContent
              label={t('workspace.invite.role')}
              items={roles}
              renderItem={(item) => (
                <SelectItem value={item.value} label={item.label}>
                  <SelectItemIndicator />
                  <SelectItemText>{item.label}</SelectItemText>
                </SelectItem>
              )}
            />
          </Select>
          <TextFieldHint>{roleDescription(role)}</TextFieldHint>
        </View>

        {/* Not Dialog `actions`: a declarative action cannot show the submit's spinner. */}
        <View className="flex-row justify-end gap-2">
          <Button appearance="outline" onPress={() => control.close()} disabled={isPending}>
            {t('common.cancel')}
          </Button>
          <Button
            appearance="solid"
            tone="accent"
            onPress={handleSubmit}
            disabled={!canSubmit}
            loading={isPending}
          >
            {t('workspace.invite.submit')}
          </Button>
        </View>
      </View>
    </Dialog>
  );
}
