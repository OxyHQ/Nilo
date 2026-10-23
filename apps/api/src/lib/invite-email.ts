/**
 * Oxy sends Nilo's workspace invitation template through the shared workload transport.
 * INVITE_EMAILS_ENABLED is the operational mail switch; own products need no scope grant.
 * The original invitation/issue idempotency key and user-visible failure handling stay intact.
 */
import { OXY_API_URL, oxyServiceTransport } from '../capabilities/oxy-service.js';
import type { WorkspaceInviteRow } from '../repositories/workspaceInvites.js';
import { log } from './logger.js';
import { publicAppUrl } from './public-links.js';

/** `sent`: Oxy accepted it. `failed`: it refused or could not be reached. `disabled`: not attempted. */
export type InviteEmailOutcome = 'sent' | 'failed' | 'disabled';

/** How long the invite request waits for Oxy before answering without the email. */
const REQUEST_TIMEOUT_MS = 5_000;

/** Oxy's limit on the resource name the subject line carries. */
const RESOURCE_NAME_MAX_LENGTH = 100;

export function inviteEmailsEnabled(): boolean {
  return process.env.INVITE_EMAILS_ENABLED?.trim() === 'true';
}

/** The link an invitation's email carries, or null for one made before links. */
export function inviteUrl(invite: Pick<WorkspaceInviteRow, 'token'>): string | null {
  return invite.token ? publicAppUrl(`/invite/${invite.token}`) : null;
}

/**
 * The key Oxy deduplicates on: the invitation AND its issue. Renewing an
 * invitation stamps a new `createdAt`, so it is a new email (which Oxy's
 * one-an-hour budget per address still bounds); a retry of the same issue is
 * the same one.
 */
export function inviteEmailIdempotencyKey(
  invite: Pick<WorkspaceInviteRow, 'id' | 'createdAt'>,
): string {
  return `${invite.id}.${invite.createdAt.getTime()}`;
}

function resourceName(workspaceName: string): string {
  const inline = workspaceName.replace(/\s+/g, ' ').trim();
  return inline.length <= RESOURCE_NAME_MAX_LENGTH
    ? inline
    : `${inline.slice(0, RESOURCE_NAME_MAX_LENGTH - 1).trimEnd()}…`;
}

async function post(body: string, key: string): Promise<Response> {
  return oxyServiceTransport().fetch(`${OXY_API_URL}/apps/invitations/email`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': key,
    },
    body,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

/** Have Oxy email the invitation. Never throws. */
export async function sendInviteEmail(input: {
  invite: WorkspaceInviteRow;
  workspaceName: string;
  locale: string | undefined;
}): Promise<InviteEmailOutcome> {
  if (!inviteEmailsEnabled()) return 'disabled';
  const { invite } = input;
  const context = { inviteId: invite.id, workspaceId: invite.workspaceId };
  try {
    const acceptUrl = inviteUrl(invite);
    if (!acceptUrl) {
      log.general.warn(
        { ...context, hasLink: Boolean(acceptUrl) },
        'Invitation email not sent: no invitation link',
      );
      return 'failed';
    }
    const body = JSON.stringify({
      to: invite.email,
      inviterUserId: invite.invitedBy,
      resourceName: resourceName(input.workspaceName),
      acceptUrl,
      ...(input.locale ? { locale: input.locale } : {}),
    });
    const key = inviteEmailIdempotencyKey(invite);
    const response = await post(body, key);
    if (response.ok) return 'sent';
    const refusal = (await response.json().catch(() => null)) as {
      error?: unknown;
      details?: { reason?: unknown };
    } | null;
    log.general.warn(
      {
        ...context,
        status: response.status,
        error: refusal?.error,
        reason: refusal?.details?.reason,
      },
      'Oxy refused the invitation email',
    );
    return 'failed';
  } catch (err: unknown) {
    log.general.warn({ ...context, err }, 'Invitation email could not be sent');
    return 'failed';
  }
}
