import { useMemo, useState } from 'react';
import { act, create, type ReactTestRenderer, type ReactTestInstance } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { DialogControlProps } from '@oxy.so/bloom/dialog';
import { BloomTestProviders } from '@/test-support/bloom-providers';
import { TeamspaceDialog, type TeamspaceSelection } from '../teamspace-dialog';
import apiClient from '@/lib/api/client';
import type { Teamspace } from '@/lib/hooks/use-teamspaces';

jest.mock('@oxy.so/services', () => ({
  useOxy: () => ({ isAuthenticated: true, user: { id: 'me' } }),
}));
jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string, params?: { name?: string }) => (params?.name ? `${key}:${params.name}` : key),
  }),
}));
jest.mock('@/lib/hooks/use-workspaces', () => ({ useWorkspaceRole: () => 'editor' }));
jest.mock('@/lib/hooks/use-member-profiles', () => ({
  useMemberProfiles: () => ({
    data: [
      { id: 'me', name: 'Me' },
      { id: 'other', name: 'Other' },
      { id: 'new', name: 'New' },
    ],
  }),
  profileName: (profile?: { name: string }) => profile?.name,
}));
// The dialog's own surface needs native overlay modules; its content is what is tested.
jest.mock('@oxy.so/bloom/dialog', () => {
  const { createElement } = require('react');
  const { View } = require('react-native');
  return {
    Dialog: ({ children }: { children: React.ReactNode }) => createElement(View, null, children),
  };
});
jest.mock('@/lib/api/client', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  },
}));
let client: QueryClient;
let renderer: ReactTestRenderer;
let teamspace: Teamspace;
const close = jest.fn();
/** Holds what the caller holds: the dialog's control and its selection. */
function Harness({ initial }: { initial: TeamspaceSelection }) {
  const [selection, setSelection] = useState(initial);
  const control = useMemo<DialogControlProps>(
    () => ({ id: 'teamspace', ref: { current: null }, open: () => {}, close: () => close() }),
    [],
  );
  return (
    <TeamspaceDialog
      control={control}
      workspaceId="w"
      selection={selection}
      onSelect={setSelection}
    />
  );
}
async function mount(initial: TeamspaceSelection = teamspace) {
  await act(async () => {
    renderer = create(
      <BloomTestProviders>
        <QueryClientProvider client={client}>
          <Harness initial={initial} />
        </QueryClientProvider>
      </BloomTestProviders>,
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
// Every pressable named by a label; the first node per label is the Bloom
// component itself, the rest are the hosts it renders.
function buttons() {
  const seen = new Set<string>();
  return renderer.root.findAll((node) => {
    const label = node.props.accessibilityLabel;
    if (typeof label !== 'string' || typeof node.props.onPress !== 'function') return false;
    if (seen.has(label)) return false;
    seen.add(label);
    return true;
  });
}
function button(label: string) {
  const result = buttons().find((b) => b.props.accessibilityLabel === label);
  if (!result) throw new Error(`Missing button ${label}`);
  return result;
}
function inputs(): ReactTestInstance[] {
  return renderer.root.findAll(
    (node) => typeof node.props.label === 'string' && typeof node.props.onChangeText === 'function',
  );
}
function privacy() {
  const [group] = renderer.root.findAll(
    (node) =>
      node.props.label === 'workspace.teamspaces.privacyLabel' && Array.isArray(node.props.options),
  );
  if (!group) throw new Error('Missing privacy group');
  return group;
}
async function press(label: string) {
  await act(async () => {
    button(label).props.onPress();
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
beforeEach(() => {
  jest.clearAllMocks();
  teamspace = {
    id: 't',
    workspaceId: 'w',
    name: 'Team',
    icon: null,
    description: '',
    privacy: 'closed',
    isDefault: false,
    archived: false,
    role: 'owner',
    createdAt: '',
  };
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  jest.mocked(apiClient.get).mockImplementation(async (url) => ({
    data: url.endsWith('/teamspaces')
      ? { teamspaces: [teamspace] }
      : url === '/teamspaces/t/members'
        ? {
            members: [
              { userId: 'me', role: teamspace.role },
              { userId: 'other', role: 'member' },
            ],
          }
        : { members: [{ userId: 'me' }, { userId: 'other' }, { userId: 'new' }] },
  }));
  jest.mocked(apiClient.post).mockResolvedValue({ data: { teamspace } });
});
afterEach(() => {
  act(() => renderer.unmount());
  client.clear();
});

it('shows hydrated names and prevents removing or demoting the last owner', async () => {
  await mount();
  expect(button('workspace.teamspaces.removeName:Me').props.disabled).toBe(true);
  expect(button('workspace.teamspaces.changeRoleFor:Me').props.disabled).toBe(true);
  expect(button('workspace.teamspaces.leave').props.disabled).toBe(true);
  await press('workspace.teamspaces.addName:New');
  expect(apiClient.put).toHaveBeenCalledWith('/teamspaces/t/members/new', { role: 'member' });
  await press('workspace.teamspaces.changeRoleFor:Other');
  expect(apiClient.put).toHaveBeenCalledWith('/teamspaces/t/members/other', { role: 'owner' });
});

it('lets a member read and leave without seeing management controls', async () => {
  teamspace.role = 'member';
  await mount();
  expect(inputs().every((i) => i.props.editable === false)).toBe(true);
  expect(buttons().some((b) => b.props.accessibilityLabel === 'common.save')).toBe(false);
  expect(buttons().some((b) => b.props.accessibilityLabel === 'workspace.teamspaces.archive')).toBe(
    false,
  );
  expect(
    buttons().some((b) => b.props.accessibilityLabel.startsWith('workspace.teamspaces.removeName')),
  ).toBe(false);
  await press('workspace.teamspaces.leave');
  expect(apiClient.delete).toHaveBeenCalledWith('/teamspaces/t/members/me');
  expect(close).toHaveBeenCalled();
});

it('locks default privacy and hides archive, remove and leave', async () => {
  teamspace.isDefault = true;
  teamspace.privacy = 'open';
  await mount();
  expect(privacy().props.disabled).toBe(true);
  const labels = buttons().map((b) => b.props.accessibilityLabel);
  expect(labels).not.toContain('workspace.teamspaces.archive');
  expect(labels).not.toContain('workspace.teamspaces.leave');
  expect(labels.some((label) => label.startsWith('workspace.teamspaces.removeName'))).toBe(false);
  await press('common.save');
  expect(apiClient.patch).toHaveBeenCalledWith('/teamspaces/t', {
    name: 'Team',
    icon: null,
    description: '',
  });
});

it('creates with the entered name, icon, description and privacy', async () => {
  await mount('create');
  for (const [field, value] of [
    ['name', 'Research'],
    ['icon', '🔬'],
    ['description', 'Notes'],
  ]) {
    await act(async () =>
      inputs()
        .find((input) => input.props.label === `workspace.teamspaces.${field}`)
        ?.props.onChangeText(value),
    );
  }
  await act(async () => privacy().props.onValueChange('private'));
  await press('workspace.teamspaces.create');
  expect(apiClient.post).toHaveBeenCalledWith('/workspaces/w/teamspaces', {
    name: 'Research',
    icon: '🔬',
    description: 'Notes',
    privacy: 'private',
  });
});

it('archives only after confirmation', async () => {
  await mount();
  await press('workspace.teamspaces.archive');
  expect(apiClient.patch).not.toHaveBeenCalled();
  await press('workspace.teamspaces.confirmArchive');
  expect(apiClient.patch).toHaveBeenCalledWith('/teamspaces/t', { archived: true });
});
