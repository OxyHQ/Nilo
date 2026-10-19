-- oxy:deploy-phase=pre
-- Blocks admit one more type, `child_page` (a subpage shown in its parent).
-- Additive: the image before it writes none. The CHECK is replaced NOT VALID
-- (no scan of `blocks` under this migration's lock) and validated in 0048.
ALTER TABLE "blocks" DROP CONSTRAINT "blocks_type";--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_type" CHECK ("blocks"."type" in ('paragraph', 'heading_1', 'heading_2', 'heading_3', 'bulleted_list_item', 'numbered_list_item', 'todo', 'quote', 'divider', 'code', 'callout', 'toggle', 'image', 'video', 'audio', 'file', 'pdf', 'bookmark', 'embed', 'columns', 'column', 'canvas_note', 'table', 'table_row', 'table_cell', 'button', 'link_to_page', 'child_page', 'sync_block', 'breadcrumb', 'table_of_contents', 'equation', 'mermaid', 'inline_database')) NOT VALID;