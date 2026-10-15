-- oxy:deploy-phase=pre
-- Additive: a column with a default, and a CHECK that admits one more block type.
ALTER TABLE "blocks" DROP CONSTRAINT "blocks_type";--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "mode" text DEFAULT 'document' NOT NULL;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_type" CHECK ("blocks"."type" in ('paragraph', 'heading_1', 'heading_2', 'heading_3', 'bulleted_list_item', 'numbered_list_item', 'todo', 'quote', 'divider', 'code', 'callout', 'toggle', 'image', 'video', 'audio', 'file', 'pdf', 'bookmark', 'embed', 'columns', 'column', 'canvas_note', 'table', 'table_row', 'table_cell', 'button', 'link_to_page', 'sync_block', 'breadcrumb', 'table_of_contents', 'equation', 'mermaid', 'inline_database'));--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_mode" CHECK ("pages"."mode" in ('document', 'canvas'));