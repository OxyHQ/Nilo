import { type SuggestionAnchor } from '@oxy.so/bloom/chat-composer';
import type { BlockId } from '../model/document';
import { type SlashItem } from '../model/slash';
/** The editor owns the command; Bloom owns its anchored suggestion surface. */
export declare function SlashMenu({ blockId, onChoose, anchor, listboxId, }: {
    blockId: BlockId;
    onChoose: (item: SlashItem) => void;
    anchor: SuggestionAnchor;
    listboxId: string;
}): import("react").JSX.Element | null;
//# sourceMappingURL=SlashMenu.d.ts.map