/**
 * Shared types for per-block-type renderers. Each renderer takes the Block
 * plus a small surface for committing content edits — keeps the dispatcher
 * (`block.tsx`) and the editor itself free of per-type plumbing.
 */
import type * as React from 'react';
import { isSafeUrl } from '@oxy.so/nilo-contracts';
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
}

/**
 * A URL a block loads or links to, or '' when there is none a reader can
 * safely follow (`isSafeUrl`). The page's Yjs document is what the editor
 * renders, so a `javascript:` URL in it is refused here, not only when the
 * server projects the page.
 */
export function blockUrl(value: unknown): string {
  return isSafeUrl(value as string | undefined) ? (value as string).trim() : '';
}

/**
 * What someone typed into a block's URL field, as a URL: `example.com` is
 * `https://example.com`, as a browser's address bar reads it. A scheme they
 * typed is kept, so an unsafe one still reads as none (`blockUrl`).
 */
export function typedUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed || /^[a-z][a-z0-9+.-]*:/i.test(trimmed) || /^[/#]/.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}
