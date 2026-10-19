import * as React from 'react';
import { Platform, View } from 'react-native';
import { RiMagicLine } from '@oxy.so/bloom/icons/RiMagicLine';
import { router } from 'expo-router';
import { Button } from '@oxy.so/bloom/button';
import {
  SegmentedControl,
  SegmentedControlItem,
  SegmentedControlItemText,
} from '@oxy.so/bloom/segmented-control';
import { TextFieldInput } from '@oxy.so/bloom/text-field';
import { Text } from '@oxy.so/bloom/typography';
import axios from 'axios';
import { useTranslation } from '@/hooks/useTranslation';
import apiClient from '@/lib/api/client';
import { apiErrorMessage } from '@/lib/api/error-message';
import { API_ROUTES } from '@/lib/api/routes';
import { useCreatePage, useDuplicatePage, usePage } from '@/lib/hooks/use-pages';
import { useWorkspaceStore } from '@/lib/stores/workspace-store';
import type { ButtonAction } from '@/lib/types/pages';
import { PagePicker } from '../page-picker';
import { type BlockComponentProps, blockUrl, typedUrl } from './types';
import { useDraft } from './use-draft';

const ACTIONS: readonly ButtonAction[] = ['navigate', 'new-page', 'duplicate-template', 'webhook'];

/**
 * Configurable button block. Renders a styled button + a small inline form
 * to set the label and action. Clicking the button fires the action:
 *   - navigate:           opens `content.url` (web new tab, native browser)
 *   - new-page:           creates a page in the current workspace and opens it
 *   - duplicate-template: makes a page from the template in `templateId`
 *   - webhook:            the server POSTs to the block's `webhookUrl`
 *                         (`/pages/:id/blocks/:blockId/webhook`)
 *
 * Every action reports how it went inline, never by throwing. A reader can
 * press the button but not change it.
 */
export function ButtonBlock({ block, onChangeContent, readOnly }: BlockComponentProps) {
  const { t } = useTranslation();
  const storedLabel = typeof block.content.label === 'string' ? block.content.label : '';
  const label = storedLabel || t('editor.blocks.button.defaultLabel');
  const action: ButtonAction = (block.content.action as ButtonAction | undefined) ?? 'navigate';
  const targetUrl = blockUrl(block.content.url);
  const templateId = typeof block.content.templateId === 'string' ? block.content.templateId : '';
  const set = (patch: Record<string, unknown>) => onChangeContent({ ...block.content, ...patch });
  const labelField = useDraft(storedLabel, (next) => set({ label: next }));
  const urlField = useDraft(targetUrl, (next) => set({ url: typedUrl(next) }));
  const webhookField = useDraft(blockUrl(block.content.webhookUrl), (next) =>
    set({ webhookUrl: typedUrl(next) }),
  );

  const [editing, setEditing] = React.useState(false);
  const [choosingTemplate, setChoosingTemplate] = React.useState(false);
  const [status, setStatus] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const template = usePage(templateId || undefined);
  const createPage = useCreatePage();
  const duplicatePage = useDuplicatePage();

  const click = async () => {
    setStatus(null);
    setBusy(true);
    try {
      if (action === 'navigate' && targetUrl) {
        if (Platform.OS === 'web') {
          window.open(targetUrl, '_blank', 'noopener,noreferrer');
        } else {
          const mod = await import('expo-web-browser');
          await mod.openBrowserAsync(targetUrl);
        }
      } else if (action === 'new-page') {
        if (!workspaceId) return;
        const page = await createPage.mutateAsync({ workspaceId, title: '' });
        router.push(`/p/${page.id}`);
      } else if (action === 'duplicate-template') {
        if (!templateId || !workspaceId) {
          setStatus(t('editor.blocks.button.setTemplate'));
        } else {
          const copy = await duplicatePage.mutateAsync({
            id: templateId,
            workspaceId,
            fromTemplate: true,
          });
          router.push(`/p/${copy.id}`);
        }
      } else if (action === 'webhook') {
        if (!blockUrl(block.content.webhookUrl)) {
          setStatus(t('editor.blocks.button.setWebhook'));
        } else {
          await apiClient.post(API_ROUTES.blocks.webhook(block.pageId, block.id));
          setStatus(t('editor.blocks.button.fired'));
        }
      } else {
        setStatus(t('editor.blocks.button.configure'));
      }
    } catch (err) {
      const status = axios.isAxiosError(err) ? err.response?.data?.status : undefined;
      setStatus(
        typeof status === 'number'
          ? t('editor.blocks.button.webhookFailed', { status })
          : apiErrorMessage(err, t('editor.blocks.button.failed')),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="gap-1 my-1">
      <View className="flex-row items-center gap-2">
        <Button
          appearance="solid"
          tone="accent"
          size="sm"
          onPress={click}
          disabled={busy}
          leadingIcon={RiMagicLine}
        >
          {busy ? t('editor.blocks.button.working') : label}
        </Button>
        {readOnly ? null : (
          <Button appearance="plain" size="xs" onPress={() => setEditing((v) => !v)}>
            {editing ? t('editor.blocks.button.done') : t('editor.blocks.button.edit')}
          </Button>
        )}
      </View>
      {editing && !readOnly ? (
        <View className="rounded-md border border-border bg-muted/30 p-2 gap-1">
          <TextFieldInput
            label={t('editor.blocks.button.labelField')}
            size="sm"
            {...labelField}
            placeholder={t('editor.blocks.button.defaultLabel')}
          />
          <SegmentedControl
            type="radio"
            size="sm"
            value={action}
            onValueChange={(a) => set({ action: a })}
          >
            {ACTIONS.map((a) => (
              <SegmentedControlItem key={a} value={a}>
                <SegmentedControlItemText>
                  {t(`editor.blocks.button.actions.${a}`)}
                </SegmentedControlItemText>
              </SegmentedControlItem>
            ))}
          </SegmentedControl>
          {action === 'navigate' ? (
            <TextFieldInput
              label={t('editor.blocks.button.link')}
              size="sm"
              {...urlField}
              placeholder="https://…"
            />
          ) : null}
          {action === 'webhook' ? (
            <TextFieldInput
              label={t('editor.blocks.button.webhook')}
              size="sm"
              {...webhookField}
              placeholder="https://…"
            />
          ) : null}
          {action === 'duplicate-template' ? (
            <View className="flex-row items-center gap-2">
              <Text className="text-xs text-muted-foreground">
                {t('editor.blocks.button.template')}:
              </Text>
              <Button
                appearance="outline"
                size="xs"
                disabled={!workspaceId}
                onPress={() => setChoosingTemplate(true)}
              >
                {templateId
                  ? template.data?.page.title || t('pages.untitled')
                  : t('editor.blocks.button.chooseTemplate')}
              </Button>
            </View>
          ) : null}
        </View>
      ) : null}
      {choosingTemplate && workspaceId ? (
        <PagePicker
          workspaceId={workspaceId}
          templates
          title={t('editor.blocks.button.chooseTemplate')}
          onChoose={(page) => set({ templateId: page.id })}
          onClose={() => setChoosingTemplate(false)}
        />
      ) : null}
      {status ? <Text className="text-xs text-muted-foreground">{status}</Text> : null}
    </View>
  );
}
