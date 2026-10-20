import type React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { BloomTestProviders } from '@/test-support/bloom-providers';
import { InviteMemberModal } from '../invite-member-modal';

const mockInvite = jest.fn();
const mockToast = { success: jest.fn(), warning: jest.fn(), error: jest.fn() };
let mockActions: { label: string; onPress?: () => void }[] = [];

// The dialog's own surface needs native overlay modules; its content and
// actions are what is tested.
jest.mock('@oxy.so/bloom/dialog', () => {
  const { createElement } = require('react');
  const { View } = require('react-native');
  return {
    Dialog: ({
      children,
      actions,
    }: {
      children: React.ReactNode;
      actions: { label: string; onPress?: () => void }[];
    }) => {
      mockActions = actions;
      return createElement(View, null, children);
    },
  };
});
jest.mock('@oxy.so/bloom/toast', () => ({
  toast: {
    success: (message: string) => mockToast.success(message),
    warning: (message: string) => mockToast.warning(message),
    error: (message: string) => mockToast.error(message),
  },
}));
jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${Object.values(params).join('|')}` : key,
  }),
}));
jest.mock('@/lib/i18n', () => ({
  __esModule: true,
  default: { locale: 'es-ES', t: (k: string) => k },
}));
jest.mock('@/lib/hooks/use-workspace-members', () => ({
  useInviteMember: () => ({ mutate: mockInvite, isPending: false }),
}));
jest.mock('../role-labels', () => ({
  roleLabel: (role: string) => role,
  roleDescription: (role: string) => role,
}));

let renderer: ReactTestRenderer | undefined;
const control = { close: jest.fn() };

async function invite(answer: unknown) {
  await act(async () => {
    renderer = create(
      <BloomTestProviders>
        <InviteMemberModal control={control as never} workspaceId="ws1" />
      </BloomTestProviders>,
    );
  });
  const input = (renderer as ReactTestRenderer).root.findAll(
    (node) => typeof node.props.onChangeText === 'function',
  )[0];
  act(() => input.props.onChangeText('guest@example.org'));
  act(() => mockActions[0].onPress?.());
  expect(mockInvite).toHaveBeenCalledWith(
    { email: 'guest@example.org', role: 'editor', locale: 'es-ES' },
    expect.anything(),
  );
  act(() => mockInvite.mock.calls[0][1].onSuccess(answer));
}

beforeEach(() => jest.clearAllMocks());
afterEach(() => {
  act(() => renderer?.unmount());
});

describe('inviting someone without an Oxy account', () => {
  const pending = {
    pending: true,
    invite: { id: 'i1', email: 'guest@example.org', role: 'editor', url: 'u' },
  };

  it('says the invitation was emailed when Oxy took it', async () => {
    await invite({ ...pending, email: 'sent' });
    expect(mockToast.success).toHaveBeenCalledWith(
      'workspace.invite.emailed:guest@example.org|editor',
    );
    expect(control.close).toHaveBeenCalled();
  });

  it("says the email couldn't be sent, and to share the link, when Oxy refused it", async () => {
    await invite({ ...pending, email: 'failed' });
    expect(mockToast.warning).toHaveBeenCalledWith(
      'workspace.invite.notEmailed:guest@example.org|editor',
    );
    expect(mockToast.success).not.toHaveBeenCalled();
  });

  it('points to the link when invitation email is off', async () => {
    await invite({ ...pending, email: 'disabled' });
    expect(mockToast.success).toHaveBeenCalledWith(
      'workspace.invite.pending:guest@example.org|editor',
    );
  });

  it('says someone with an Oxy account was added', async () => {
    await invite({ member: { userId: 'u1' } });
    expect(mockToast.success).toHaveBeenCalledWith(
      'workspace.invite.invited:guest@example.org|editor',
    );
  });
});
