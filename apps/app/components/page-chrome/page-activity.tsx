import { useState } from 'react';
import { useUserById } from '@oxy.so/services/ui/client';
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
import { profileName } from '@/lib/hooks/use-member-profiles';
import { usePageVersions, type PageVersion } from '@/lib/hooks/use-page-extras';
import type { Page } from '@/lib/types/pages';
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

function VersionActivity({
  version,
  now,
  onPress,
}: {
  version: PageVersion;
  now: number;
  onPress: () => void;
}) {
  const { t, locale } = useTranslation();
  const profile = useUserById(version.createdBy);
  const name = profileName(profile.data) ?? t('pages.info.unknownMember');
  return (
    <Item
      leading={<Avatar source={profile.data?.avatar} name={name} size="sm" />}
      title={t('pages.activity.savedBy', { name })}
      subtitle={t('pages.activity.versionDetails', {
        count: version.blockCount,
        time: relativeEditTime(version.createdAt, locale, now),
      })}
      onPress={onPress}
    />
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
  const { t } = useTranslation();
  const versions = usePageVersions(page.id);
  const now = usePageClock();
  const [selectedVersion, setSelectedVersion] = useState<string | null>(null);
  return (
    <>
      <Screen
        header={
          <PageHeader
            presentation="navigation"
            border="none"
            safeArea={false}
            title={t('pages.activity.title')}
            actions={
              presentation === 'floating' ? undefined : (
                <CloseButton accessibilityLabel={t('pages.activity.close')} onPress={onClose} />
              )
            }
          />
        }
      >
        <ScreenScrollView>
          <PageActivitySummary page={page} />
          <Item title={t('pages.history.title')} subtitle={t('pages.activity.versionHint')} />
          {versions.isLoading ? (
            <Loading variant="spinner" accessibilityLabel={t('common.loading')} />
          ) : versions.isError ? (
            <Button appearance="plain" onPress={() => void versions.refetch()}>
              {t('pages.history.loadFailed')} · {t('pages.publish.retry')}
            </Button>
          ) : !versions.data?.versions.length ? (
            <Item title={t('pages.history.empty')} />
          ) : (
            versions.data.versions.map((version) => (
              <VersionActivity
                key={version.id}
                version={version}
                now={now}
                onPress={() => setSelectedVersion(version.id)}
              />
            ))
          )}
        </ScreenScrollView>
      </Screen>
      {selectedVersion ? (
        <PageHistoryDialog
          page={page}
          initialVersionId={selectedVersion}
          onClose={() => setSelectedVersion(null)}
        />
      ) : null}
    </>
  );
}
