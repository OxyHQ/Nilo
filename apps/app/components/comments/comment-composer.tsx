import * as React from 'react';
import {
  Platform,
  type TextInputInstance,
  type TextInputKeyPressEvent,
  type TextInputSelectionChangeEvent,
  View,
} from 'react-native';
import { RiSendPlaneLine } from '@oxy.so/bloom/icons/RiSendPlaneLine';
import { Button } from '@oxy.so/bloom/button';
import { Textarea } from '@oxy.so/bloom/textarea';
import { usePanelSessionState, usePanelSessionFocus } from '@oxy.so/bloom/app-shell/hooks';
import { Text } from '@oxy.so/bloom/typography';
import { MentionPicker } from './mention-picker';
import { useTranslation } from '@/hooks/useTranslation';
import type { CommentSegment, MentionSegment } from '@/lib/types/comments';

interface CommentComposerProps {
  workspaceId: string;
  /** Stable domain identity inside the enclosing panel session. */
  sessionKey?: string;
  placeholder?: string;
  submitting?: boolean;
  autoFocus?: boolean;
  /**
   * Called when user submits the composer. Receives the typed segments —
   * mention chips are interleaved with text in caret order.
   */
  onSubmit: (segments: CommentSegment[]) => void | Promise<void>;
  onCancel?: () => void;
  initialSegments?: CommentSegment[];
}

/**
 * Internal composer model:
 *   - text: the raw editable string the user types
 *   - mentions: list of mention chips, each anchored to a [start, end) range
 *     in `text`. Each anchored mention's `originalText` lives in those bytes
 *     so the displayed text + final segments are kept in sync.
 *
 * At submit time we walk `text` left→right, splitting at mention ranges to
 * produce the final segment list.
 */
interface Anchored {
  start: number;
  end: number;
  mention: MentionSegment;
}

function segmentsToText(segments: CommentSegment[]): {
  text: string;
  anchored: Anchored[];
} {
  let cursor = 0;
  let text = '';
  const anchored: Anchored[] = [];
  for (const seg of segments) {
    if ('type' in seg && seg.type === 'mention') {
      const start = cursor;
      text += seg.originalText;
      cursor += seg.originalText.length;
      anchored.push({ start, end: cursor, mention: seg });
    } else {
      text += seg.text;
      cursor += seg.text.length;
    }
  }
  return { text, anchored };
}

function buildSegmentsFromAnchored(text: string, anchored: Anchored[]): CommentSegment[] {
  // Anchored ranges must not overlap and are sorted by start.
  const sorted = [...anchored].sort((a, b) => a.start - b.start);
  const out: CommentSegment[] = [];
  let cursor = 0;
  for (const a of sorted) {
    if (a.start > cursor) {
      out.push({ type: 'text', text: text.slice(cursor, a.start) });
    }
    out.push(a.mention);
    cursor = a.end;
  }
  if (cursor < text.length) {
    out.push({ type: 'text', text: text.slice(cursor) });
  }
  // Strip empty text segments.
  return out.filter((s) => ('type' in s && s.type === 'mention') || s.text.length > 0);
}

/**
 * After a text edit we need to re-anchor mention ranges so they still point
 * at their `originalText`. If an edit overlaps a mention range, the mention
 * is dropped (the user typed through it).
 */
function reanchor(prevText: string, prevAnchored: Anchored[], nextText: string): Anchored[] {
  // Common-prefix / common-suffix diff to localize the edit.
  let prefix = 0;
  const prevLen = prevText.length;
  const nextLen = nextText.length;
  const minLen = Math.min(prevLen, nextLen);
  while (prefix < minLen && prevText[prefix] === nextText[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < minLen - prefix &&
    prevText[prevLen - 1 - suffix] === nextText[nextLen - 1 - suffix]
  ) {
    suffix++;
  }
  const editStart = prefix;
  const editEndPrev = prevLen - suffix;
  const delta = nextLen - prevLen;

  const result: Anchored[] = [];
  for (const a of prevAnchored) {
    // Mention entirely before the edit — unchanged.
    if (a.end <= editStart) {
      result.push(a);
      continue;
    }
    // Mention entirely after the edit — shift.
    if (a.start >= editEndPrev) {
      result.push({ ...a, start: a.start + delta, end: a.end + delta });
    }
    // Otherwise the edit overlaps this mention — drop it.
  }
  return result;
}

interface DraftMentionState {
  /** Index in `text` where the `@` lives. */
  triggerIndex: number;
  /** Query string between `@` and the caret. */
  query: string;
}

/** Resolve the token at a collapsed caret, regardless of native event order. */
function mentionAtCaret(
  text: string,
  selection: { start: number; end: number },
): DraftMentionState | null {
  if (selection.start !== selection.end || selection.start > text.length) return null;
  const match = /(?:^|[ \n])@([^@ \n]*)$/.exec(text.slice(0, selection.start));
  if (!match) return null;
  return { triggerIndex: selection.start - match[1].length - 1, query: match[1] };
}

/**
 * Comment composer with inline mention autocomplete. Tracks `@` triggers,
 * surfaces the mention picker, and inserts a chip at the trigger location on
 * selection. Submit is Ctrl/Cmd+Enter (web) or the inline send button.
 */
export function CommentComposer({
  workspaceId,
  placeholder,
  submitting,
  autoFocus,
  onSubmit,
  onCancel,
  initialSegments,
  sessionKey: suppliedSessionKey,
}: CommentComposerProps) {
  const { t } = useTranslation();
  const inputRef = React.useRef<TextInputInstance>(null);
  const instanceId = React.useId();
  const sessionKey = suppliedSessionKey ?? instanceId;
  const focus = usePanelSessionFocus<TextInputInstance>(`${sessionKey}:input`);
  const setInputRef = React.useCallback(
    (input: TextInputInstance | null) => {
      inputRef.current = input;
      focus.ref(input);
    },
    [focus.ref],
  );
  const initial = React.useMemo(
    () => (initialSegments ? segmentsToText(initialSegments) : { text: '', anchored: [] }),
    [initialSegments],
  );
  const [text, setText] = usePanelSessionState(`${sessionKey}:text`, initial.text);
  // Selection may arrive in the same batch as text, before React renders it.
  const textRef = React.useRef(text);
  textRef.current = text;
  const dismissedTriggerRef = React.useRef<number | null>(null);
  const [anchored, setAnchored] = usePanelSessionState<Anchored[]>(
    `${sessionKey}:mentions`,
    initial.anchored,
  );
  const [selection, setSelection] = usePanelSessionState(`${sessionKey}:selection`, {
    start: text.length,
    end: text.length,
  });
  const selectionRef = React.useRef(selection);
  selectionRef.current = selection;
  const [mentionDraft, setMentionDraft] = usePanelSessionState<DraftMentionState | null>(
    `${sessionKey}:mention-picker`,
    null,
  );
  const [sending, setSending] = usePanelSessionState(`${sessionKey}:sending`, false);
  const [submitFailed, setSubmitFailed] = usePanelSessionState(`${sessionKey}:failed`, false);
  const [visited, setVisited] = usePanelSessionState(`${sessionKey}:visited`, false);
  const lifecycle = React.useRef({ initial, visited });
  lifecycle.current = { initial, visited };
  React.useEffect(() => {
    // A finished/cancelled composer starts from the current authoritative seed
    // on its next explicit mount. Presentation remounts keep visited=true.
    if (!lifecycle.current.visited) {
      const next = lifecycle.current.initial;
      setText(next.text);
      setAnchored(next.anchored);
      setSelection({ start: next.text.length, end: next.text.length });
      setMentionDraft(null);
      setSubmitFailed(false);
    }
    setVisited(true);
  }, [setVisited, setText, setAnchored, setSelection, setMentionDraft, setSubmitFailed]);
  const sendingRef = React.useRef(sending);
  sendingRef.current = sending;
  const busy = submitting || sending;

  const isEmpty = text.trim().length === 0 && anchored.length === 0;

  const updateMentionDraft = (nextText: string, nextAnchored = anchored) => {
    const caret = selectionRef.current.start;
    const insideMention = nextAnchored.some(
      (mention) => caret > mention.start && caret <= mention.end,
    );
    const draft = insideMention ? null : mentionAtCaret(nextText, selectionRef.current);
    setMentionDraft(draft?.triggerIndex === dismissedTriggerRef.current ? null : draft);
  };

  const dismissMention = () => {
    dismissedTriggerRef.current = mentionDraft?.triggerIndex ?? null;
    setMentionDraft(null);
  };

  const handleSelectionChange = (e: TextInputSelectionChangeEvent) => {
    selectionRef.current = e.nativeEvent.selection;
    setSelection(e.nativeEvent.selection);
    focus.onSelectionChange(e);
    updateMentionDraft(textRef.current);
  };

  const handleChangeText = (nextText: string) => {
    setVisited(true);
    const nextAnchored = reanchor(textRef.current, anchored, nextText);
    textRef.current = nextText;
    dismissedTriggerRef.current = null;
    setText(nextText);
    setAnchored(nextAnchored);
    updateMentionDraft(nextText, nextAnchored);
  };

  const handleKeyPress = (e: TextInputKeyPressEvent) => {
    const key = e.nativeEvent.key;
    if (key === 'Escape' && mentionDraft) {
      dismissMention();
    }
  };

  const handlePickMention = (mention: MentionSegment) => {
    if (!mentionDraft) return;
    setVisited(true);
    const caret = selectionRef.current.start;
    const before = text.slice(0, mentionDraft.triggerIndex);
    const after = text.slice(caret);
    const insertedText = mention.originalText;
    const nextText = `${before}${insertedText} ${after}`;
    const insertStart = mentionDraft.triggerIndex;
    const insertEnd = insertStart + insertedText.length;

    // Re-anchor existing mentions around the inserted slice, then add the new one.
    const shifted: Anchored[] = anchored
      .filter((a) => a.end <= mentionDraft.triggerIndex || a.start >= caret)
      .map((a) => {
        if (a.start >= caret) {
          const delta = insertedText.length + 1 - (caret - mentionDraft.triggerIndex);
          return { ...a, start: a.start + delta, end: a.end + delta };
        }
        return a;
      });
    const next = [...shifted, { start: insertStart, end: insertEnd, mention }];
    textRef.current = nextText;
    setText(nextText);
    setAnchored(next);
    setMentionDraft(null);
    // Move caret to right after the chip + space.
    const newCaret = insertEnd + 1;
    selectionRef.current = { start: newCaret, end: newCaret };
    setSelection(selectionRef.current);
    // Defer focus / setSelection until the next tick so the new value is applied.
    requestAnimationFrame(() => {
      inputRef.current?.setNativeProps({ selection: { start: newCaret, end: newCaret } });
      inputRef.current?.focus();
    });
  };

  const handleSubmit = async () => {
    if (isEmpty || submitting || sending || sendingRef.current) return;
    const segments = buildSegmentsFromAnchored(text, anchored);
    if (segments.length === 0) return;
    sendingRef.current = true;
    setSending(true);
    setSubmitFailed(false);
    try {
      await onSubmit(segments);
      textRef.current = '';
      dismissedTriggerRef.current = null;
      setText('');
      setSelection({ start: 0, end: 0 });
      setAnchored([]);
      setMentionDraft(null);
      setVisited(false);
    } catch {
      setSubmitFailed(true);
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  const handleCancel = () => {
    setText('');
    setSelection({ start: 0, end: 0 });
    setAnchored([]);
    setMentionDraft(null);
    setSubmitFailed(false);
    setVisited(false);
    onCancel?.();
  };
  const cancelRef = React.useRef(handleCancel);
  cancelRef.current = handleCancel;

  // The keydown listener below is attached once per mentionDraft/onCancel, so it
  // calls the latest submit through a ref: a captured `handleSubmit` would see
  // the text as it was when the listener was attached (empty), and Cmd/Ctrl+Enter
  // would send nothing.
  const submitRef = React.useRef(handleSubmit);
  submitRef.current = handleSubmit;

  // Web: intercept Cmd/Ctrl+Enter to submit, Esc to cancel.
  React.useEffect(() => {
    if (Platform.OS !== 'web') return;
    const node = inputRef.current as unknown as HTMLElement | null;
    if (!node || typeof node.addEventListener !== 'function') return;
    const handler = (ev: Event) => {
      const e = ev as KeyboardEvent;
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        void submitRef.current();
      }
      if (e.key === 'Escape') {
        if (mentionDraft) {
          e.preventDefault();
          dismissedTriggerRef.current = mentionDraft.triggerIndex;
          setMentionDraft(null);
          return;
        }
        if (onCancel) {
          e.preventDefault();
          cancelRef.current();
        }
      }
    };
    node.addEventListener('keydown', handler);
    return () => node.removeEventListener('keydown', handler);
  }, [mentionDraft, onCancel, setMentionDraft]);

  return (
    <View className="gap-2">
      <View>
        <Textarea
          inputRef={setInputRef}
          onFocus={focus.onFocus}
          onBlur={focus.onBlur}
          value={text}
          onChangeText={handleChangeText}
          onKeyPress={handleKeyPress}
          onSelectionChange={handleSelectionChange}
          placeholder={placeholder ?? t('comments.composer.placeholder')}
          rows={2}
          autoResize
          autoFocus={autoFocus && !visited}
          editable={!busy}
        />
        {mentionDraft ? (
          <MentionPicker
            open
            workspaceId={workspaceId}
            query={mentionDraft.query}
            onSelect={handlePickMention}
            onClose={dismissMention}
          />
        ) : null}
      </View>
      {submitFailed ? (
        <Text accessibilityRole="alert" className="text-sm text-destructive">
          {t('comments.composer.failed')}
        </Text>
      ) : null}
      <View className="flex-row items-center justify-between">
        <Text className="text-[10px] text-muted-foreground">
          {Platform.OS === 'web' ? t('comments.composer.hintWeb') : t('comments.composer.hint')}
        </Text>
        <View className="flex-row items-center gap-2">
          {onCancel ? (
            <Button
              appearance="subtle"
              size="sm"
              onPress={handleCancel}
              disabled={busy}
              accessibilityLabel={t('common.cancel')}
            >
              {t('common.cancel')}
            </Button>
          ) : null}
          <Button
            appearance="solid"
            tone="accent"
            size="sm"
            onPress={handleSubmit}
            disabled={isEmpty || busy}
            loading={busy}
            accessibilityLabel={t('comments.composer.send')}
            leadingIcon={RiSendPlaneLine}
          >
            {busy ? t('comments.composer.posting') : t('comments.composer.submit')}
          </Button>
        </View>
      </View>
    </View>
  );
}
