/** What a page exports as, in the order the menu offers them. */
export const EXPORT_FORMATS = ['md', 'html', 'pdf'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
