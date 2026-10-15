/**
 * One AI action on a block or on the whole page: choose it, wait for it (or
 * cancel), read the result, then decide what it does to the page. Nothing
 * changes until the member applies it, and applying it is one undo step.
 */
import type { BlockId, EditorStore } from '@oxy.so/bloom-editor/model';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Text } from '@/components/ui/text';
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
import { useColorScheme } from '@/lib/useColorScheme';

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
  const { colors } = useColorScheme();
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
    onClose();
  };
  const replaceable =
    target.kind === 'block' && canReplaceText(store.doc, store.schema, target.blockId);

  const actions = target.kind === 'block' ? BLOCK_ACTIONS : PAGE_ACTIONS;
  const failure = run.isError && run.error && !isAbort(run.error) ? failureOf(run.error) : null;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          abort.current?.abort();
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-lg gap-3">
        <DialogTitle>{t(target.kind === 'block' ? 'ai.titleBlock' : 'ai.titlePage')}</DialogTitle>
        {run.isPending ? (
          <View className="flex-row items-center gap-3 py-4" accessibilityLiveRegion="polite">
            <ActivityIndicator color={colors.mutedForeground} />
            <Text className="flex-1 text-sm text-muted-foreground">{t('ai.working')}</Text>
            <Button variant="ghost" size="sm" onPress={cancel}>
              <Text>{t('common.cancel')}</Text>
            </Button>
          </View>
        ) : run.isSuccess ? (
          <>
            <ScrollView
              className="max-h-80 rounded-md border border-border p-3"
              accessibilityLabel={t('ai.result')}
            >
              <Text selectable className="text-sm text-foreground">
                {run.data}
              </Text>
            </ScrollView>
            <Text className="text-xs text-muted-foreground">{t('ai.check')}</Text>
            {notice ? (
              <Text className="text-sm text-foreground" accessibilityLiveRegion="polite">
                {t(`ai.notice.${notice}`)}
              </Text>
            ) : target.kind === 'block' && !replaceable ? (
              <Text className="text-xs text-muted-foreground">{t('ai.notice.insertOnly')}</Text>
            ) : null}
            <View className="flex-row flex-wrap justify-end gap-2">
              <Button variant="ghost" onPress={onClose}>
                <Text>{t('ai.discard')}</Text>
              </Button>
              {last ? (
                <Button variant="outline" onPress={() => start(last.action, last.language)}>
                  <Text>{t('ai.again')}</Text>
                </Button>
              ) : null}
              {target.kind === 'block' ? (
                <>
                  <Button
                    variant={replaceable ? 'outline' : 'default'}
                    disabled={notice === 'blockGone'}
                    onPress={() => apply('below')}
                  >
                    <Text>{t('ai.insertBelow')}</Text>
                  </Button>
                  {replaceable ? (
                    <Button disabled={notice !== null} onPress={() => apply('replace')}>
                      <Text>{t('ai.replace')}</Text>
                    </Button>
                  ) : null}
                </>
              ) : (
                <Button onPress={() => apply('top')}>
                  <Text>{t('ai.insertTop')}</Text>
                </Button>
              )}
            </View>
          </>
        ) : choosingLanguage ? (
          <View className="gap-1">
            <View className="flex-row items-center justify-between">
              <Text className="text-sm text-muted-foreground">{t('ai.chooseLanguage')}</Text>
              <Button variant="ghost" size="sm" onPress={() => setChoosingLanguage(false)}>
                <Text>{t('ai.back')}</Text>
              </Button>
            </View>
            {TRANSLATION_LANGUAGES.map((language) => (
              <Button
                key={language}
                variant="ghost"
                className="justify-start"
                onPress={() => start('translate', language)}
              >
                <Text>{t(`ai.languages.${language}`)}</Text>
              </Button>
            ))}
          </View>
        ) : (
          <View className="gap-1">
            {failure ? <FailureNote failure={failure} /> : null}
            {actions.map((action) => (
              <Button
                key={action}
                variant="ghost"
                className="justify-start"
                onPress={() => (action === 'translate' ? setChoosingLanguage(true) : start(action))}
              >
                <Text>{t(`ai.actions.${action}`)}</Text>
              </Button>
            ))}
          </View>
        )}
      </DialogContent>
    </Dialog>
  );
}

const isAbort = (error: unknown) => error instanceof Error && error.name === 'AbortError';

function FailureNote({ failure }: { failure: AiFailure }) {
  const { t } = useTranslation();
  const requestId = 'requestId' in failure ? failure.requestId : undefined;
  return (
    <View className="mb-1 gap-0.5 rounded-md bg-muted p-2" accessibilityLiveRegion="polite">
      <Text className="text-sm text-foreground">{t(`ai.failure.${failure.kind}`)}</Text>
      {requestId ? (
        <Text selectable className="text-xs text-muted-foreground">
          {t('ai.requestId', { id: requestId })}
        </Text>
      ) : null}
    </View>
  );
}
