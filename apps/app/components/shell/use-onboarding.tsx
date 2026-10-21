import { useMemo, useRef } from 'react';
import { View } from 'react-native';
import { AliaAvatarIcon } from '@alia.onl/sdk/avatar';
import { Dialog, useDialogControl } from '@oxy.so/bloom/dialog';
import { Item } from '@oxy.so/bloom/item';
import type { SidebarOnboardingCardProps, SidebarOnboardingStep } from '@oxy.so/bloom/sidebar';
import { Text } from '@oxy.so/bloom/typography';
import { useOxy } from '@oxy.so/services/ui/client';
import { useAskAlia } from '@/components/ask-alia';
import { useNiloSettings } from '@/components/settings/settings-provider';
import { useTranslation } from '@/hooks/useTranslation';
import { usePages } from '@/lib/hooks/use-pages';
import { useWorkspaceRole } from '@/lib/hooks/use-workspaces';
import { hasRole } from '@/lib/hooks/workspace-roles';
import { useNewPageStore } from '@/lib/stores/new-page-store';
import { useUIStore } from '@/lib/stores/ui-store';

/** Bloom owns the welcome card; Nilo supplies actions and actual page progress. */
export function useOnboarding(workspaceId: string | null) {
  const { t } = useTranslation();
  const { isAuthenticated, user } = useOxy();
  const role = useWorkspaceRole(workspaceId);
  const { data } = usePages(isAuthenticated ? workspaceId : null);
  const openNewPage = useNewPageStore((state) => state.open);
  const setDrawerOpen = useUIStore((state) => state.setSidebarOpen);
  const setPaletteOpen = useUIStore((state) => state.setCommandPaletteOpen);
  const askAlia = useAskAlia();
  const { open: openSettings } = useNiloSettings();
  const control = useDialogControl();
  const afterClose = useRef<(() => void) | null>(null);
  const ready = isAuthenticated && Boolean(workspaceId);

  const steps = useMemo<SidebarOnboardingStep[]>(() => {
    const run = (action: () => void) => () => {
      setDrawerOpen(false);
      action();
    };
    return [
      ...(workspaceId && hasRole(role, 'editor')
        ? [
            {
              key: 'write',
              label: t('sidebar.welcome.write'),
              completed:
                data?.pages.some(
                  (page) =>
                    page.ownerId === user?.id &&
                    !page.archived &&
                    !page.template &&
                    !page.databaseId,
                ) ?? false,
              onPress: run(() => openNewPage({ workspaceId, parentId: null })),
            },
          ]
        : []),
      { key: 'ask', label: t('sidebar.welcome.ask'), onPress: run(askAlia) },
      {
        key: 'search',
        label: t('sidebar.welcome.search'),
        onPress: run(() => setPaletteOpen(true)),
      },
      ...(hasRole(role, 'admin')
        ? [
            {
              key: 'invite',
              label: t('sidebar.welcome.invite'),
              onPress: run(() => openSettings('members')),
            },
          ]
        : []),
    ];
  }, [
    workspaceId,
    role,
    data?.pages,
    user?.id,
    t,
    setDrawerOpen,
    openNewPage,
    askAlia,
    setPaletteOpen,
    openSettings,
  ]);

  const onboarding = useMemo<SidebarOnboardingCardProps | undefined>(
    () =>
      ready
        ? {
            title: t('sidebar.welcome.title'),
            leading: <AliaAvatarIcon width={20} height={20} />,
            steps,
            onPress: () => {
              setDrawerOpen(false);
              control.open();
            },
            onSeeAll: () => {
              setDrawerOpen(false);
              control.open();
            },
            seeAllLabel: t('sidebar.welcome.seeAll'),
          }
        : undefined,
    [ready, t, steps, control, setDrawerOpen],
  );

  const dialogs = ready ? (
    <Dialog
      control={control}
      title={t('sidebar.welcome.title')}
      label={t('sidebar.welcome.title')}
      placement={{ base: 'bottom', md: 'center' }}
      onClose={() => {
        const action = afterClose.current;
        afterClose.current = null;
        action?.();
      }}
      actions={[{ label: t('common.close'), color: 'cancel' }]}
    >
      <View className="gap-3">
        <Text className="text-sm text-muted-foreground">{t('sidebar.welcome.description')}</Text>
        {steps.map((step) => (
          <Item
            key={step.key}
            title={step.label}
            subtitle={t(`sidebar.welcome.details.${step.key}`)}
            accessibilityLabel={step.label}
            onPress={() => {
              afterClose.current = step.onPress ?? null;
              control.close();
            }}
          />
        ))}
      </View>
    </Dialog>
  ) : null;
  return { onboarding, dialogs };
}
