import { dateMentionMatches, formatMentionDate } from './date-mentions';
import type { MentionItem } from '@oxy.so/bloom-editor';
import type { WorkspaceMember } from '@/lib/hooks/use-workspace-members';
import type { PagePermissions } from '@/lib/hooks/use-page-permissions';

export const normalizeMentionQuery = (value: string) =>
  value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase().trim();

export function mentionablePeople(
  members: readonly WorkspaceMember[],
  permissions: PagePermissions | undefined,
): Pick<WorkspaceMember, 'userId' | 'user'>[] {
  if (!permissions) return [];
  const people = new Map<string, Pick<WorkspaceMember, 'userId' | 'user'>>();
  for (const member of members) {
    if (permissions.openToWorkspace || member.role === 'owner' || member.role === 'admin') {
      people.set(member.userId, member);
    }
  }
  for (const grant of permissions.grants) {
    if (grant.user || !people.has(grant.userId)) people.set(grant.userId, grant);
  }
  return [...people.values()];
}

export function mentionSearchResults({
  text,
  people,
  pages,
  labels,
  locale = 'en',
  now,
}: {
  text: string;
  people: readonly { id: string; name: string }[];
  pages: readonly { id: string; title: string }[];
  labels: { people: string; pages: string; untitled: string; date: string };
  locale?: string;
  now?: Date;
}): MentionItem[] {
  const query = normalizeMentionQuery(text);
  const matches = (label: string) => normalizeMentionQuery(label).includes(query);
  const seen = new Set<string>();
  const users = people
    .filter((person) => matches(person.name))
    .slice(0, query ? 20 : 5)
    .map(({ id, name }) => ({
      id: `user:${id}`,
      label: name,
      group: labels.people,
      attributes: { kind: 'user', id },
    }));
  const documents = pages
    .filter(({ id, title }) => {
      if (seen.has(id) || !matches(title.trim() || labels.untitled)) return false;
      seen.add(id);
      return true;
    })
    .slice(0, query ? 20 : 5)
    .map(({ id, title }) => ({
      id: `page:${id}`,
      label: title.trim() || labels.untitled,
      group: labels.pages,
      attributes: { kind: 'page', id },
    }));
  const dates = dateMentionMatches(text, now).map(({ date, time }) => {
    const attributes: Record<string, string> = { kind: 'date', date };
    if (time) attributes.time = time;
    return {
      id: time ? `date:${date}T${time}` : `date:${date}`,
      label: formatMentionDate(date, locale, time) ?? date,
      group: labels.date,
      attributes,
    };
  });
  return [...users, ...documents, ...dates];
}
