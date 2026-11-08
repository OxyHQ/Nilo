/**
 * `/_oxy/capabilities/<tool>`: the internal invocation surface of Nilo's
 * catalogs (notes, pages, memories), for Alia. A call carries an Oxy capability ticket for exactly this
 * tool and resource; it is verified and re-authorised live, checked against
 * the tool, run, and audited, whatever the outcome.
 */
import { createHash } from 'node:crypto';
import { Router, type RequestHandler } from 'express';
import type { AppCapabilityCatalog, CapabilityTicketClaims, CatalogTool } from '@oxy.so/contracts';
import { inputSatisfiesCapabilityLimits, readCapabilityAuthorization } from '@oxy.so/core/server';
import { jsonObjectSchemaToZod } from '@oxy.so/mcp';

import {
  auditCapabilityTicket,
  verifyCapabilityTicket,
} from '../capabilities/capability-authority.js';
import { capabilityRefusal } from '../capabilities/capability-refusal.js';
import { IdempotencyConflictError } from '../capabilities/idempotency.js';
import { MEMORIES_CAPABILITY_CATALOG } from '../capabilities/memories.catalog.js';
import { executeMemoryTool } from '../capabilities/memories.handlers.js';
import { NILO_CAPABILITY_CATALOG } from '../capabilities/nilo.catalog.js';
import { executeNiloTool } from '../capabilities/nilo.handlers.js';
import { NOTES_CAPABILITY_CATALOG } from '../capabilities/notes.catalog.js';
import { executeNotesTool, NotesCapabilityError } from '../capabilities/notes.handlers.js';
import { queryInputFor } from '../capabilities/query-input.js';
import { NiloCapabilityError } from '../capabilities/tool-input.js';
import { log } from '../lib/logger.js';

const router = Router();

type Input = Readonly<Record<string, unknown>>;

/**
 * One catalog served here: who signs its tickets (its audience and app id), which
 * resource a ticket may name, and what runs the tool. A refusal of the tool's own
 * is told apart from a crash by `refusalOf`.
 */
interface Lane {
  catalog: AppCapabilityCatalog;
  /** The resource types, besides the account, a ticket may name, and the input that must match each. */
  resourceInputs: Readonly<Record<string, string>>;
  execute(tool: string, input: Input, accountId: string): Promise<Record<string, unknown>>;
  refusalOf(error: unknown): { status: number; code: string } | null;
}

const LANES: readonly Lane[] = [
  {
    catalog: NOTES_CAPABILITY_CATALOG,
    resourceInputs: { note: 'noteId', label: 'labelId' },
    execute: executeNotesTool,
    refusalOf: (error) => (error instanceof NotesCapabilityError ? error : null),
  },
  {
    catalog: NILO_CAPABILITY_CATALOG,
    resourceInputs: { page: 'pageId' },
    execute: executeNiloTool,
    refusalOf: (error) => (error instanceof NiloCapabilityError ? error : null),
  },
  {
    catalog: MEMORIES_CAPABILITY_CATALOG,
    resourceInputs: { memory: 'memoryId' },
    execute: executeMemoryTool,
    refusalOf: (error) => (error instanceof NiloCapabilityError ? error : null),
  },
];

function resourceMatches(
  lane: Lane,
  claims: CapabilityTicketClaims,
  tool: CatalogTool,
  input: Input,
): boolean {
  const resource = claims.resource;
  if (resource.appId !== lane.catalog.appId) return false;
  if (!tool.resourceTypes.includes(resource.resourceType)) return false;
  if (resource.resourceType === lane.catalog.accountResourceType) {
    return resource.resourceId === resource.effectiveAccountId;
  }
  const inputKey = lane.resourceInputs[resource.resourceType];
  return inputKey !== undefined && input[inputKey] === resource.resourceId;
}

function registerRoute(tool: CatalogTool, run: RequestHandler): void {
  const path = `/${tool.name}`;
  // Express 4 does not catch a rejected handler: anything thrown outside the
  // steps' own handling would leave the call hanging until Alia times out.
  const handler: RequestHandler = (request, response, next) => {
    Promise.resolve(run(request, response, next)).catch((error: unknown) => {
      log.general.error({ err: error, tool: tool.name }, 'Capability call failed');
      if (!response.headersSent)
        response.status(500).json({ error: 'capability_execution_failed' });
    });
  };
  switch (tool.invocation.method) {
    case 'GET':
      router.get(path, handler);
      break;
    case 'POST':
      router.post(path, handler);
      break;
    case 'PATCH':
      router.patch(path, handler);
      break;
    case 'PUT':
      router.put(path, handler);
      break;
    case 'DELETE':
      router.delete(path, handler);
      break;
  }
}

function serve(lane: Lane, tool: CatalogTool): void {
  const parseInput = jsonObjectSchemaToZod(tool.inputSchema);
  const parseOutput = tool.outputSchema ? jsonObjectSchemaToZod(tool.outputSchema) : null;

  registerRoute(tool, async (request, response) => {
    const ticket = readCapabilityAuthorization(request.header('authorization'));
    if (!ticket) {
      response.status(401).json({ error: 'capability_ticket_required' });
      return;
    }

    // Oxy's signature and its live decision, both, before anything else.
    let claims: CapabilityTicketClaims;
    try {
      claims = await verifyCapabilityTicket(lane.catalog, ticket);
    } catch (error) {
      const refusal = capabilityRefusal(error);
      if (refusal === 'unavailable') {
        log.general.error({ err: error, tool: tool.name }, 'Capability authority unavailable');
        response.status(503).json({ error: 'capability_authority_unavailable' });
      } else if (refusal === 'denied') {
        response.status(403).json({ error: 'capability_revoked_or_denied' });
      } else {
        response.status(401).json({ error: 'invalid_capability_ticket' });
      }
      return;
    }

    const rawInput =
      tool.invocation.method === 'GET' ? queryInputFor(tool, request.query) : request.body;
    const parsedInput = parseInput.safeParse(rawInput);
    if (!parsedInput.success) {
      response.status(400).json({ error: 'capability_input_schema_mismatch' });
      return;
    }
    const input = parsedInput.data as Record<string, unknown>;
    const capabilityMatches = tool.requiredCapabilities.every((required) =>
      claims.capabilities.includes(required),
    );
    if (
      claims.tool !== tool.name ||
      !capabilityMatches ||
      !resourceMatches(lane, claims, tool, input)
    ) {
      void auditCapabilityTicket({
        ticket,
        result: { status: 'denied', code: 'capability_scope_mismatch' },
        rollbackSupported: tool.rollback === 'supported',
      }).catch((error: unknown) => {
        log.general.error({ err: error, ticketId: claims.jti }, 'Capability denial audit failed');
      });
      response.status(403).json({ error: 'capability_scope_mismatch' });
      return;
    }
    if (!inputSatisfiesCapabilityLimits(tool.name, input, claims.limits)) {
      void auditCapabilityTicket({
        ticket,
        result: { status: 'denied', code: 'capability_limit_exceeded' },
        rollbackSupported: tool.rollback === 'supported',
      }).catch((error: unknown) => {
        log.general.error({ err: error, ticketId: claims.jti }, 'Capability limit audit failed');
      });
      response.status(403).json({ error: 'capability_limit_exceeded' });
      return;
    }

    const rawIdempotencyKey =
      typeof input.idempotencyKey === 'string' ? input.idempotencyKey : undefined;
    const idempotencyKeyHash = rawIdempotencyKey
      ? createHash('sha256').update(rawIdempotencyKey).digest('hex')
      : undefined;

    try {
      const result = await lane.execute(tool.name, input, claims.resource.effectiveAccountId);
      const output = parseOutput ? parseOutput.parse(result) : result;
      await auditCapabilityTicket({
        ticket,
        result: { status: 'succeeded' },
        rollbackSupported: tool.rollback === 'supported',
        idempotencyKeyHash,
      }).catch((error: unknown) => {
        log.general.error({ err: error, ticketId: claims.jti }, 'Capability success audit failed');
      });
      response.json(output);
    } catch (error) {
      const own = lane.refusalOf(error);
      const conflict = error instanceof IdempotencyConflictError;
      const status = own ? own.status : conflict ? 409 : 500;
      const code = own
        ? own.code
        : conflict
          ? 'idempotency_conflict'
          : 'capability_execution_failed';
      await auditCapabilityTicket({
        ticket,
        result: { status: 'failed', code },
        rollbackSupported: tool.rollback === 'supported',
        idempotencyKeyHash,
      }).catch((auditError: unknown) => {
        log.general.error(
          { err: auditError, ticketId: claims.jti },
          'Capability failure audit failed',
        );
      });
      if (status === 500) {
        log.general.error(
          { err: error, ticketId: claims.jti, tool: tool.name },
          'Capability execution failed',
        );
      }
      response.status(status).json({ error: code });
    }
  });
}

for (const lane of LANES) {
  for (const tool of lane.catalog.tools.filter(({ exposure }) => exposure.includes('internal'))) {
    serve(lane, tool);
  }
}

export default router;
