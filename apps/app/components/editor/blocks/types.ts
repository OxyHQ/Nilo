/**
 * Shared types for per-block-type renderers. Each renderer takes the Block
 * plus a small surface for committing content edits — keeps the dispatcher
 * (`block.tsx`) and the editor itself free of per-type plumbing.
 */
import type * as React from 'react';
import type { EditorStore } from '@oxy.so/bloom-editor';
import { normalizeContent } from '@oxy.so/nilo-contracts';
import type { Block, BlockContent, BlockType } from '@/lib/types/pages';

export interface BlockComponentProps {
  block: Block;
  /** Patch the block's `content`. Editor debounces save. */
  onChangeContent: (next: BlockContent) => void;
  /** Optional: change the block's type (used by callers like upload buttons). */
  onChangeType?: (type: BlockType) => void;
  /** True when the block was just created / clicked into. */
  autoFocus?: boolean;
  /** Read-only render (e.g. share-link preview). */
  readOnly?: boolean;
  /**
   * Container-block hook — returns the rendered child blocks of the given
   * parent id (their `parentBlockId === parentId`). Editor wires this so
   * containers like columns / table don't need to know about block lists.
   * When omitted, containers render an inline placeholder.
   */
  renderChildren?: (parentId: string) => React.ReactNode;
  /**
   * The editor's store, for a container that lays out and changes its own
   * structure (a table's rows and columns, a layout's columns). Absent where
   * blocks are only read (a shared page).
   */
  store?: EditorStore;
}

/**
 * A block's content as the contract reads it (`normalizeContent`): a URL no
 * reader can safely follow (`javascript:`…) is none. The page's Yjs document
 * is what the editor renders, so it is read here, not only when the server
 * projects the page. A field the contract refuses is dropped rather than the
 * block, so a malformed one still shows the rest.
 */
export function blockContent(type: BlockType, content: object): BlockContent {
  try {
    return normalizeContent(type, content) as BlockContent;
  } catch (error) {
    const issues = (error as { issues?: { path: PropertyKey[] }[] }).issues;
    if (!Array.isArray(issues)) throw error;
    const refused = new Set(issues.map((issue) => issue.path[0]));
    const kept = Object.entries(content).filter(([key]) => !refused.has(key));
    return normalizeContent(type, Object.fromEntries(kept)) as BlockContent;
  }
}

/**
 * What someone typed into a block's URL field, as a URL: `example.com` is
 * `https://example.com`, as a browser's address bar reads it. A scheme they
 * typed is kept, so an unsafe one still reads as none (`blockContent`).
 */
export function typedUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed || /^[a-z][a-z0-9+.-]*:/i.test(trimmed) || /^[/#]/.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}
