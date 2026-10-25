/**
 * Running Nilo's AI actions through Oxy's inference edge, as the signed-in
 * member: the session's own bearer, so Oxy decides whether this member and
 * this app may spend, which routes qualify and in what sequence. Nilo names a
 * power level and nothing else, holds no key and never retries: the edge and
 * Kaana already have, and say so in the error.
 */
import { createInferenceClient, OxyInferenceError } from '@oxy.so/core/inference';
import { useOxy, useSupervision } from '@oxy.so/services/ui/client';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import {
  type AiActionId,
  answerText,
  MAX_INPUT_CHARS,
  messagesFor,
  type TranslationLanguage,
} from './actions';

/** The power level Nilo's actions run at: cheap, fast, enough for rewriting and summaries. */
export const AI_POWER_LEVEL = 'instant';

/** What went wrong, as the member can act on it. */
export type AiFailure =
  | { kind: 'tooLong' }
  | { kind: 'empty' }
  | { kind: 'tryLater'; requestId?: string }
  | { kind: 'account'; requestId?: string }
  | { kind: 'unavailable'; requestId?: string };

export class AiActionError extends Error {
  constructor(readonly failure: AiFailure) {
    super(failure.kind);
  }
}

/** The member-facing reading of an edge refusal (its `code`, never its HTTP status). */
export function failureOf(error: unknown): AiFailure {
  if (error instanceof AiActionError) return error.failure;
  if (!(error instanceof OxyInferenceError)) return { kind: 'unavailable' };
  const requestId = error.requestId;
  if (error.retryable) return { kind: 'tryLater', requestId };
  switch (error.code) {
    case 'insufficient_balance':
    case 'spending_limit_exceeded':
    case 'quota_exceeded':
      return { kind: 'account', requestId };
    case 'context_length_exceeded':
    case 'request_too_large':
      return { kind: 'tooLong' };
    default:
      return { kind: 'unavailable', requestId };
  }
}

function useInferenceClient() {
  const { oxyServices } = useOxy();
  return useMemo(() => createInferenceClient(oxyServices), [oxyServices]);
}

/** Availability is the current account's route catalogue, refreshed with supervision state. */
export function useAiAvailable(): boolean {
  const { canUsePrivateApi, user, activeSessionId, oxyServices } = useOxy();
  const supervision = useSupervision();
  const client = useInferenceClient();
  const levels = useQuery({
    queryKey: [
      'ai',
      'power-levels',
      user?.id,
      activeSessionId,
      oxyServices.http.getSessionEpoch(),
      supervision.dataUpdatedAt,
    ],
    queryFn: ({ signal }) => client.listRoutingProfiles({ signal }),
    enabled: canUsePrivateApi && Boolean(user?.id && activeSessionId),
    staleTime: 10 * 60_000,
    retry: false,
  });
  return canUsePrivateApi && (levels.data?.some((level) => level.slug === AI_POWER_LEVEL) ?? false);
}

export interface AiRequest {
  action: AiActionId;
  /** The member's text, as Markdown. */
  text: string;
  language?: TranslationLanguage;
}

/** One action, answered as Markdown. */
export function useAiAction() {
  const client = useInferenceClient();
  return useMutation<string, unknown, AiRequest & { signal?: AbortSignal }>({
    retry: false,
    mutationFn: async ({ action, text, language, signal }) => {
      const input = text.trim();
      if (!input) throw new AiActionError({ kind: 'empty' });
      if (input.length > MAX_INPUT_CHARS) throw new AiActionError({ kind: 'tooLong' });
      const answer = await client.respond(
        { routingProfile: AI_POWER_LEVEL, input: messagesFor(action, input, language) },
        { signal },
      );
      const result = answerText(answer.output);
      if (!result) throw new AiActionError({ kind: 'unavailable', requestId: answer.requestId });
      return result;
    },
  });
}
