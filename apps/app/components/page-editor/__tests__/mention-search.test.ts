import { mentionablePeople, mentionSearchResults } from '../mention-search';
import type { PagePermissions } from '@/lib/hooks/use-page-permissions';
import type { WorkspaceMember } from '@/lib/hooks/use-workspace-members';

const labels = { people: 'Personas', pages: 'Páginas', untitled: 'Sin título' };
const people = [
  { id: 'same', name: 'José Díaz' },
  { id: 'other', name: 'Ana' },
];
const pages = [
  { id: 'same', title: 'Reunión' },
  { id: 'empty', title: ' ' },
];
const search = (text: string) => mentionSearchResults({ text, people, pages, labels });

it('groups people and pages with localized headings and canonical attributes', () => {
  expect(search('')).toEqual([
    {
      id: 'user:same',
      label: 'José Díaz',
      group: 'Personas',
      attributes: { kind: 'user', id: 'same' },
    },
    {
      id: 'user:other',
      label: 'Ana',
      group: 'Personas',
      attributes: { kind: 'user', id: 'other' },
    },
    {
      id: 'page:same',
      label: 'Reunión',
      group: 'Páginas',
      attributes: { kind: 'page', id: 'same' },
    },
    {
      id: 'page:empty',
      label: 'Sin título',
      group: 'Páginas',
      attributes: { kind: 'page', id: 'empty' },
    },
  ]);
});
it('matches case, accents and decomposed Unicode for both groups', () => {
  expect(search('  JOSE  ').map((item) => item.label)).toEqual(['José Díaz']);
  expect(search('DIÁZ').map((item) => item.label)).toEqual(['José Díaz']);
  expect(search('REUNIO\u0301N').map((item) => item.label)).toEqual(['Reunión']);
  expect(search('missing')).toEqual([]);
});
it('limits initial suggestions per group and deduplicates ranked pages', () => {
  const result = mentionSearchResults({
    text: '',
    labels,
    people: Array.from({ length: 8 }, (_, i) => ({ id: `${i}`, name: `Person ${i}` })),
    pages: [...pages, ...pages],
  });
  expect(result.filter((item) => item.group === labels.people)).toHaveLength(5);
  expect(result.filter((item) => item.group === labels.pages)).toHaveLength(2);
});
const member = (userId: string, role: WorkspaceMember['role'] = 'editor'): WorkspaceMember => ({
  userId,
  role,
  invitedBy: null,
  joinedAt: '',
  user: null,
});
const permissions: PagePermissions = {
  pageId: 'page',
  restricted: true,
  restrictedFrom: 'parent',
  openToWorkspace: false,
  role: 'editor',
  grants: [
    {
      userId: 'shared',
      user: null,
      role: 'viewer',
      grantedBy: 'owner',
      inheritedFrom: 'parent',
      viaShareLink: false,
      createdAt: '',
    },
  ],
};
it('includes explicit/inherited shares and limits restricted pages to people who can open them', () => {
  const members = [
    member('owner', 'owner'),
    member('admin', 'admin'),
    member('private'),
    member('shared'),
  ];
  expect(mentionablePeople(members, permissions).map((p) => p.userId)).toEqual([
    'owner',
    'admin',
    'shared',
  ]);
  expect(mentionablePeople(members, { ...permissions, openToWorkspace: true })).toHaveLength(4);
  expect(mentionablePeople(members, undefined)).toEqual([]);
});
