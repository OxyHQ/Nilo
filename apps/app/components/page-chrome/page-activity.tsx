import { useState } from 'react';
import { useOxy, useUserById } from '@oxy.so/services/ui/client';
import { ActivityFeed, type ActivityFeedEntry } from '@oxy.so/bloom/activity-feed';
import { Tabs, TabsTrigger } from '@oxy.so/bloom/tabs';
import { RiHistoryLine } from '@oxy.so/bloom/icons/RiHistoryLine';
import { Avatar } from '@oxy.so/bloom/avatar';
import { useAppShellPanel } from '@oxy.so/bloom/app-shell/hooks';
import { Button, CloseButton } from '@oxy.so/bloom/button';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@oxy.so/bloom/hover-card';
import { Item } from '@oxy.so/bloom/item';
import { Loading } from '@oxy.so/bloom/loading';
import { PageHeader } from '@oxy.so/bloom/page-header';
import { Screen, ScreenScrollView } from '@oxy.so/bloom/screen';
import { Text } from '@oxy.so/bloom/typography';
import { useTranslation } from '@/hooks/useTranslation';
import { profileName, useMemberProfiles } from '@/lib/hooks/use-member-profiles';
import { usePageActivity } from '@/lib/hooks/use-page-activity';
import type { Page } from '@/lib/types/pages';
import { ActivityChanges } from './activity-changes';
import { PageHistoryDialog } from './page-history-dialog';
import { relativeEditTime, usePageClock } from './page-time';

function ActivityPerson({
  userId,
  date,
  kind,
  now,
}: {
  userId: string | null;
  date: string;
  kind: 'edited' | 'created';
  now: number;
}) {
  const { t, locale } = useTranslation();
  const profile = useUserById(userId);
  const name = profileName(profile.data) ?? t('pages.info.unknownMember');
  const parsed = new Date(date);
  const valid = Number.isFinite(parsed.getTime());
  const label = t(`pages.activity.${kind}By`, { name });
  return (
    <Item
      leading={<Avatar source={profile.data?.avatar} name={name} size="sm" />}
      title={label}
      trailing={
        <Text variant="caption-2-regular" className="text-muted-foreground">
          {kind === 'edited'
            ? relativeEditTime(date, locale, now)
            : valid
              ? new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(parsed)
              : ''}
        </Text>
      }
      accessibilityLabel={`${label}${valid ? `, ${parsed.toLocaleString(locale)}` : ''}`}
    />
  );
}

function PageActivitySummary({ page }: { page: Page }) {
  const now = usePageClock();
  return (
    <>
      <ActivityPerson
        userId={page.lastEditedBy ?? null}
        date={page.updatedAt}
        kind="edited"
        now={now}
      />
      <ActivityPerson userId={page.ownerId} date={page.createdAt} kind="created" now={now} />
    </>
  );
}

/** Bloom owns hover intent/positioning; clicking opens the compositor's activity panel. */
export function PageActivity({ page, onOpen }: { page: Page; onOpen: () => void }) {
  const { t, locale } = useTranslation();
  const now = usePageClock();
  const [hovered, setHovered] = useState(false);
  return (
    <HoverCard open={hovered} onOpenChange={setHovered}>
      <HoverCardTrigger asChild>
        <Button
          appearance="plain"
          tone="neutral"
          accessibilityLabel={t('pages.activity.open')}
          onPress={() => {
            setHovered(false);
            onOpen();
          }}
        >
          <Text variant="caption-2-regular" className="text-muted-foreground">
            {t('pages.info.edited', { time: relativeEditTime(page.updatedAt, locale, now) })}
          </Text>
        </Button>
      </HoverCardTrigger>
      <HoverCardContent
        label={t('pages.activity.title')}
        align="end"
        padded={false}
        style={{ width: 320 }}
      >
        <Item title={t('pages.activity.title')} />
        <PageActivitySummary page={page} />
      </HoverCardContent>
    </HoverCard>
  );
}

export function PageActivityPanel({
  page,
  open,
  onClose,
}: {
  page: Page;
  open: boolean;
  onClose: () => void;
}) {
  return open ? <ActivityPanelContent key={page.id} page={page} onClose={onClose} /> : null;
}

function ActivityPanelContent({ page, onClose }: { page: Page; onClose: () => void }) {
  const { presentation } = useAppShellPanel();
  const { t, locale } = useTranslation();
  const { user } = useOxy();
  const activity = usePageActivity(page);
  const profiles = useMemberProfiles(activity.items.flatMap((event) => event.actorIds));
  const [historyOpen, setHistoryOpen] = useState(false);
  const entries: ActivityFeedEntry[] = activity.items.map((event) => {
    const names = event.actorIds.map((id) =>
      id === user?.id
        ? t('pages.activity.you')
        : (profileName(profiles.data?.find((profile) => profile.id === id)) ??
          t('pages.info.unknownMember')),
    );
    const actor = names.length
      ? new Intl.ListFormat(locale).format(names)
      : t('pages.activity.unattributed');
    const date = new Date(event.createdAt);
    const time = Number.isFinite(date.getTime())
      ? new Intl.DateTimeFormat(locale, {
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        }).format(date)
      : '';
    return {
      id: event.id,
      actor: {
        name: actor,
        avatar:
          profiles.data?.find((profile) => profile.id === event.actorIds[0])?.avatar ?? undefined,
      },
      title: `${t(event.kind === 'created' ? 'pages.activity.created' : 'pages.activity.edited')} ${page.title || t('pages.untitled')}`,
      day: time,
      timestamp: time,
      body: event.kind === 'content_edited' ? t('pages.activity.contentEdited') : undefined,
      content: event.changes.length ? (
        <ActivityChanges changes={event.changes} pageId={page.id} />
      ) : undefined,
    };
  });
  return (
    <>
      <Screen
        header={
          <PageHeader
            presentation="navigation"
            border="none"
            safeArea={false}
            title={
              <Tabs value="updates" label={t('pages.activity.title')}>
                <TabsTrigger value="updates" label={t('pages.activity.updates')} />
              </Tabs>
            }
            actions={
              <>
                {activity.canEdit ? (
                  <Button
                    iconOnly
                    appearance="plain"
                    tone="neutral"
                    icon={RiHistoryLine}
                    accessibilityLabel={t('pages.history.title')}
                    onPress={() => setHistoryOpen(true)}
                  />
                ) : null}
                {presentation === 'floating' ? null : (
                  <CloseButton accessibilityLabel={t('pages.activity.close')} onPress={onClose} />
                )}
              </>
            }
          />
        }
      >
        <ScreenScrollView contentContainerClassName="px-4 py-3">
          {!activity.canEdit ? (
            <Item title={t('pages.activity.restricted')} />
          ) : activity.isLoading ? (
            <Loading variant="spinner" accessibilityLabel={t('common.loading')} />
          ) : (
            <>
              <ActivityFeed
                entries={entries}
                density="compact"
                grouping="none"
                accessibilityLabel={t('pages.activity.updates')}
                emptyLabel={
                  activity.isError ? t('pages.activity.loadFailed') : t('pages.activity.empty')
                }
              />
              {activity.isError ? (
                <Button appearance="plain" onPress={() => void activity.refetch()}>
                  {t('pages.publish.retry')}
                </Button>
              ) : null}
              {activity.hasNextPage ? (
                <Button
                  appearance="plain"
                  loading={activity.isFetchingNextPage}
                  onPress={() => {
                    if (!activity.isFetchingNextPage) void activity.fetchNextPage();
                  }}
                >
                  {t('pages.activity.more')}
                </Button>
              ) : null}
            </>
          )}
        </ScreenScrollView>
      </Screen>
      {historyOpen && activity.canEdit ? (
        <PageHistoryDialog page={page} onClose={() => setHistoryOpen(false)} />
      ) : null}
    </>
  );
}
