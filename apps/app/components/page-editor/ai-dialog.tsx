/**
 * One AI action on a block or on the whole page: choose it, wait for it (or
 * cancel), read the result, then decide what it does to the page. Nothing
 * changes until the member applies it, and applying it is one undo step.
 */
import type { BlockId, EditorStore } from '@oxy.so/bloom-editor/model';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Button } from '@oxy.so/bloom/button';
import { Dialog, useDialogControl } from '@oxy.so/bloom/dialog';
import { Item } from '@oxy.so/bloom/item';
import { Loading } from '@oxy.so/bloom/loading';
import { Text } from '@oxy.so/bloom/typography';
import { useTranslation } from '@/hooks/useTranslation';
import {
  type AiActionId,
  BLOCK_ACTIONS,
  TRANSLATION_LANGUAGES,
  type TranslationLanguage,
} from '@/lib/ai/actions';
import { type AiFailure, failureOf, useAiAction } from '@/lib/ai/use-ai';
import { insertMarkdownAsNote } from '@/lib/editor/canvas';
import {
  blocksToMarkdownText,
  blockTextMarkdown,
  canReplaceText,
  insertMarkdownAfter,
  insertMarkdownAtTop,
  isSameText,
  replaceBlockText,
} from '@/lib/editor/markdown-blocks';

/** What an action reads: one block (and what it holds), or the whole page. */
export type AiTarget = { kind: 'block'; blockId: BlockId } | { kind: 'page' };

const PAGE_ACTIONS: readonly AiActionId[] = ['summarize'];

export function AiDialog({
  store,
  target,
  canvas = false,
  onClose,
}: {
  store: EditorStore;
  target: AiTarget;
  /** The page is a canvas: what goes on the page goes in a new note. */
  canvas?: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const control = useDialogControl();
  const run = useAiAction();
  const [choosingLanguage, setChoosingLanguage] = useState(false);
  const [last, setLast] = useState<{ action: AiActionId; language?: TranslationLanguage } | null>(
    null,
  );
  const [notice, setNotice] = useState<'blockChanged' | 'blockGone' | null>(null);
  const abort = useRef<AbortController | null>(null);
  /** What the action read, to tell whether the block changed since. */
  const sent = useRef('');
  useEffect(() => () => abort.current?.abort(), []);

  // A block's own text (not what it holds); the page's whole content.
  const source = () =>
    target.kind === 'block'
      ? blockTextMarkdown(store.doc, target.blockId)
      : blocksToMarkdownText(store.doc, store.doc.root);

  const start = (action: AiActionId, language?: TranslationLanguage) => {
    abort.current?.abort();
    abort.current = new AbortController();
    setChoosingLanguage(false);
    setNotice(null);
    setLast({ action, language });
    sent.current = source();
    run.mutate({ action, text: sent.current, language, signal: abort.current.signal });
  };
  const cancel = () => {
    abort.current?.abort();
    run.reset();
    setLast(null);
  };
  const apply = (how: 'replace' | 'below' | 'top') => {
    const markdown = run.data;
    if (!markdown) return;
    if (target.kind === 'block') {
      // Someone deleted the block, or wrote in it, while the action ran:
      // nothing of theirs is overwritten, and the member is told.
      if (!store.doc.blocks[target.blockId]) {
        setNotice('blockGone');
        return;
      }
      if (how === 'replace' && !isSameText(store.doc, target.blockId, sent.current)) {
        setNotice('blockChanged');
        return;
      }
    }
    store.sealHistory();
    store.run((c) => {
      if (how === 'top')
        return canvas ? insertMarkdownAsNote(c, markdown) : insertMarkdownAtTop(c, markdown);
      if (target.kind !== 'block') return null;
      return how === 'replace'
        ? replaceBlockText(c, target.blockId, markdown)
        : insertMarkdownAfter(c, target.blockId, markdown);
    });
    control.close();
  };
  const replaceable =
    target.kind === 'block' && canReplaceText(store.doc, store.schema, target.blockId);

  const actions = target.kind === 'block' ? BLOCK_ACTIONS : PAGE_ACTIONS;
  const failure = run.isError && run.error && !isAbort(run.error) ? failureOf(run.error) : null;

  return (
    <Dialog
      control={control}
      startOpen
      onClose={() => {
        abort.current?.abort();
        onClose();
      }}
      placement={{ base: 'bottom', md: 'center' }}
      maxWidth={512}
      title={t(target.kind === 'block' ? 'ai.titleBlock' : 'ai.titlePage')}
    >
      <View className="gap-3">
        {run.isPending ? (
          <View className="flex-row items-center gap-3 py-4" accessibilityLiveRegion="polite">
            <Loading variant="inline" size="sm" />
            <Text className="flex-1 text-sm text-muted-foreground">{t('ai.working')}</Text>
            <Button appearance="subtle" tone="neutral" size="sm" onPress={cancel}>
              {t('common.cancel')}
            </Button>
          </View>
        ) : run.isSuccess ? (
          <>
            <ScrollView
              className="max-h-80 rounded-md border border-border p-3"
              accessibilityLabel={t('ai.result')}
            >
              <Text selectable className="text-sm text-foreground web:select-text">
                {run.data}
              </Text>
            </ScrollView>
            <Text className="text-xs text-muted-foreground">{t('ai.check')}</Text>
            {notice ? (
              <Text variant="body-regular" accessibilityLiveRegion="polite">
                {t(`ai.notice.${notice}`)}
              </Text>
            ) : target.kind === 'block' && !replaceable ? (
              <Text className="text-xs text-muted-foreground">{t('ai.notice.insertOnly')}</Text>
            ) : null}
            <View className="flex-row flex-wrap justify-end gap-2">
              <Button appearance="subtle" tone="neutral" onPress={() => control.close()}>
                {t('ai.discard')}
              </Button>
              {last ? (
                <Button
                  appearance="outline"
                  tone="neutral"
                  onPress={() => start(last.action, last.language)}
                >
                  {t('ai.again')}
                </Button>
              ) : null}
              {target.kind === 'block' ? (
                <>
                  <Button
                    appearance={replaceable ? 'outline' : 'solid'}
                    tone={replaceable ? 'neutral' : 'accent'}
                    disabled={notice === 'blockGone'}
                    onPress={() => apply('below')}
                  >
                    {t('ai.insertBelow')}
                  </Button>
                  {replaceable ? (
                    <Button
                      appearance="solid"
                      tone="accent"
                      disabled={notice !== null}
                      onPress={() => apply('replace')}
                    >
                      {t('ai.replace')}
                    </Button>
                  ) : null}
                </>
              ) : (
                <Button appearance="solid" tone="accent" onPress={() => apply('top')}>
                  {t('ai.insertTop')}
                </Button>
              )}
            </View>
          </>
        ) : choosingLanguage ? (
          <View className="gap-1">
            <View className="flex-row items-center justify-between">
              <Text className="text-sm text-muted-foreground">{t('ai.chooseLanguage')}</Text>
              <Button
                appearance="subtle"
                tone="neutral"
                size="sm"
                onPress={() => setChoosingLanguage(false)}
              >
                {t('ai.back')}
              </Button>
            </View>
            {TRANSLATION_LANGUAGES.map((language) => (
              <Item
                key={language}
                title={t(`ai.languages.${language}`)}
                density="compact"
                onPress={() => start('translate', language)}
              />
            ))}
          </View>
        ) : (
          <View className="gap-1">
            {failure ? <FailureNote failure={failure} /> : null}
            {actions.map((action) => (
              <Item
                key={action}
                title={t(`ai.actions.${action}`)}
                density="compact"
                onPress={() => (action === 'translate' ? setChoosingLanguage(true) : start(action))}
              />
            ))}
          </View>
        )}
      </View>
    </Dialog>
  );
}

const isAbort = (error: unknown) => error instanceof Error && error.name === 'AbortError';

function FailureNote({ failure }: { failure: AiFailure }) {
  const { t } = useTranslation();
  const requestId = 'requestId' in failure ? failure.requestId : undefined;
  return (
    <View className="mb-1 gap-0.5 rounded-md bg-muted p-2" accessibilityLiveRegion="polite">
      <Text variant="body-regular">{t(`ai.failure.${failure.kind}`)}</Text>
      {requestId ? (
        <Text selectable className="text-xs text-muted-foreground web:select-text">
          {t('ai.requestId', { id: requestId })}
        </Text>
      ) : null}
    </View>
  );
}
