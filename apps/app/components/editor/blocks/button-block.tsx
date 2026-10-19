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
import { useCreatePage, useDuplicatePage } from '@/lib/hooks/use-pages';
import { useWorkspaceStore } from '@/lib/stores/workspace-store';
import type { ButtonAction } from '@/lib/types/pages';
import { type BlockComponentProps, blockUrl, typedUrl } from './types';

/**
 * Configurable button block. Renders a styled button + a small inline form
 * to set the label and action. Clicking the button fires the action:
 *   - navigate:           opens `content.url` (web new tab, native browser)
 *   - new-page:           creates a page in the current workspace and opens it
 *   - duplicate-template: duplicates the page in `templateId` and opens the copy
 *   - webhook:            POSTs an empty body to `content.webhookUrl`
 *
 * All four actions are best-effort and never throw — UI surfaces feedback
 * inline.
 */
export function ButtonBlock({ block, onChangeContent }: BlockComponentProps) {
  const label = typeof block.content.label === 'string' ? block.content.label : 'Button';
  const action: ButtonAction = (block.content.action as ButtonAction | undefined) ?? 'navigate';
  const targetUrl = blockUrl(block.content.url);
  const webhookUrl = blockUrl(block.content.webhookUrl);

  // Typed URLs are drafts until the field is left: a half-typed one is not a
  // safe URL yet, and committing each keystroke would also be one write each.
  const [urlDraft, setUrlDraft] = React.useState(targetUrl);
  const [webhookDraft, setWebhookDraft] = React.useState(webhookUrl);
  const [editing, setEditing] = React.useState(false);
  const [status, setStatus] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
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
        const templateId =
          typeof block.content.templateId === 'string' ? block.content.templateId : '';
        if (!templateId || !workspaceId) {
          setStatus('Set a template page first.');
        } else {
          const copy = await duplicatePage.mutateAsync({ id: templateId, workspaceId });
          router.push(`/p/${copy.id}`);
        }
      } else if (action === 'webhook') {
        if (!webhookUrl) {
          setStatus('Set a webhook URL first.');
        } else {
          await fetch(webhookUrl, { method: 'POST' });
          setStatus('Webhook fired.');
        }
      } else {
        setStatus('Configure the action below.');
      }
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Action failed');
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
          {busy ? 'Working…' : label}
        </Button>
        <Button appearance="plain" size="xs" onPress={() => setEditing((v) => !v)}>
          {editing ? 'Done' : 'Edit'}
        </Button>
      </View>
      {editing ? (
        <View className="rounded-md border border-border bg-muted/30 p-2 gap-1">
          <TextFieldInput
            label="Button label"
            size="sm"
            value={label}
            onChangeText={(t) => onChangeContent({ ...block.content, label: t })}
            placeholder="Button label"
          />
          <SegmentedControl
            type="radio"
            size="sm"
            value={action}
            onValueChange={(a) => onChangeContent({ ...block.content, action: a })}
          >
            {(
              ['navigate', 'new-page', 'duplicate-template', 'webhook'] as readonly ButtonAction[]
            ).map((a) => (
              <SegmentedControlItem key={a} value={a}>
                <SegmentedControlItemText>{a}</SegmentedControlItemText>
              </SegmentedControlItem>
            ))}
          </SegmentedControl>
          {action === 'navigate' ? (
            <TextFieldInput
              label="https://…"
              size="sm"
              value={urlDraft}
              onChangeText={setUrlDraft}
              onBlur={() => onChangeContent({ ...block.content, url: typedUrl(urlDraft) })}
              placeholder="https://…"
            />
          ) : null}
          {action === 'webhook' ? (
            <TextFieldInput
              label="https://… (POST)"
              size="sm"
              value={webhookDraft}
              onChangeText={setWebhookDraft}
              onBlur={() =>
                onChangeContent({ ...block.content, webhookUrl: typedUrl(webhookDraft) })
              }
              placeholder="https://… (POST)"
            />
          ) : null}
        </View>
      ) : null}
      {status ? <Text className="text-xs text-muted-foreground">{status}</Text> : null}
    </View>
  );
}
