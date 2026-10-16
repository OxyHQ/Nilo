import { useState } from 'react';
import { useOxy } from '@oxy.so/services';
import {
  SettingsModal,
  type SettingsIcon,
  type SettingsModalPage,
  type SettingsNavGroup,
} from '@oxy.so/bloom/settings-modal/modal';
import { RiUserLine } from '@oxy.so/bloom/icons/RiUserLine';
import { RiSettings3Line } from '@oxy.so/bloom/icons/RiSettings3Line';
import { RiDownloadCloud2Line } from '@oxy.so/bloom/icons/RiDownloadCloud2Line';
import { RiBuilding2Line } from '@oxy.so/bloom/icons/RiBuilding2Line';
import { RiTeamLine } from '@oxy.so/bloom/icons/RiTeamLine';
import { RiFeedbackLine } from '@oxy.so/bloom/icons/RiFeedbackLine';
import { useTranslation } from '@/hooks/useTranslation';
import { MembersSection } from '@/components/workspace/members-section';
import { AccountSection } from './account-section';
import { FeedbackSection } from './feedback-section';
import { GeneralSection } from './general-section';
import { OfflineSection } from './offline-section';
import { WorkspaceSection } from './workspace-section';
import type { SettingsPage } from './settings-provider';

export default function NiloSettingsModal({
  page: requestedPage,
  initialView,
  onClose,
}: {
  page: SettingsPage;
  initialView: 'navigation' | 'page';
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { isAuthenticated } = useOxy();
  const pages: Record<string, SettingsModalPage> = {
    account: { title: t('settings.sections.account'), content: <AccountSection /> },
    general: { title: t('settings.sections.general'), content: <GeneralSection /> },
    offline: { title: t('settings.sections.offline'), content: <OfflineSection /> },
    // Workspace pages need a member: a signed-out visitor has no workspace.
    ...(isAuthenticated && {
      workspace: { title: t('settings.sections.workspace'), content: <WorkspaceSection /> },
      members: { title: t('settings.sections.members'), content: <MembersSection /> },
    }),
    feedback: { title: t('settings.sections.feedback'), content: <FeedbackSection /> },
  };
  const initialPage: SettingsPage = requestedPage in pages ? requestedPage : 'account';
  const [page, setPage] = useState<string>(initialPage);
  const item = (key: SettingsPage, icon: SettingsIcon) => {
    const target = pages[key];
    return target ? [{ key, page: key, label: target.title, icon }] : [];
  };
  const groups: SettingsNavGroup[] = [
    {
      key: 'account',
      label: t('settings.groups.account'),
      items: [
        ...item('account', RiUserLine),
        ...item('general', RiSettings3Line),
        ...item('offline', RiDownloadCloud2Line),
      ],
    },
    {
      key: 'workspace',
      label: t('settings.groups.workspace'),
      items: [...item('workspace', RiBuilding2Line), ...item('members', RiTeamLine)],
    },
    {
      key: 'support',
      label: t('settings.groups.support'),
      items: item('feedback', RiFeedbackLine),
    },
  ].filter((group) => group.items.length > 0);
  return (
    <SettingsModal
      open
      onClose={onClose}
      page={page}
      defaultPage={initialPage}
      initialView={initialView}
      onPageChange={setPage}
      pages={pages}
      groups={groups}
      labels={{ dialog: t('settings.title'), close: t('common.close'), back: t('common.back') }}
    />
  );
}
