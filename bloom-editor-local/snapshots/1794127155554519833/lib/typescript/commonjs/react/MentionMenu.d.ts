import { type SuggestionAnchor } from '@oxy.so/bloom/chat-composer';
import type { BlockId } from '../model/document';
import { type MentionItem } from './context';
/** The same shared suggestion renderer, with application-provided mention results. */
export declare function MentionMenu({ blockId, onChoose, anchor, listboxId, }: {
    blockId: BlockId;
    onChoose: (item: MentionItem) => void;
    anchor: SuggestionAnchor;
    listboxId: string;
}): import("react").JSX.Element | null;
/** A person and a page may have the same ID; keep their option IDs distinct. */
export declare function mentionSuggestionId(item: MentionItem): string;
//# sourceMappingURL=MentionMenu.d.ts.map