import {
  Bookmark,
  Calculator,
  ExternalLink,
  File as FileIcon,
  FileText,
  Image as ImageIcon,
  Link2,
  ListTree,
  MapPin,
  Music,
  RefreshCcw,
  Rows3,
  SquareDashedBottom,
  Table as TableIcon,
  Video as VideoIcon,
  Workflow,
} from 'lucide-react-native';
import i18n from '@/lib/i18n';
import { registerSlashMenuOptions, SLASH_MENU_OPTIONS, type SlashMenuOption } from '../slash-menu';

/** Reads the English catalog regardless of the active locale. */
const EN = { locale: 'en' } as const;

/**
 * Search keywords for an entry: the English label and keywords always match,
 * and the active locale's keywords are added, so `/heading` and `/encabezado`
 * both find the same block. Catalog keyword lists are comma-separated.
 */
function searchTerms(...lists: string[]): string[] {
  const out = new Set<string>();
  for (const list of lists) {
    for (const raw of list.split(',')) {
      const term = raw.trim();
      if (term) out.add(term);
    }
  }
  return [...out];
}

type LocalizedText = Pick<SlashMenuOption, 'label' | 'description' | 'keywords'>;

/**
 * Phase 3 (more block types) slash-menu entries. Their text is read through
 * getters so it resolves when the menu renders and filters, in whatever
 * language is active then — never frozen at module load. Registered as a side-effect
 * import — `apps/app/components/editor/editor.tsx` already imports the
 * slash-menu module on first render, so loading these entries before the menu
 * renders only requires importing this file from `block.tsx`.
 *
 * Coordinated with Editor v2 (#13): the framework owns the slash menu shell
 * and registry. We contribute entries here without forking that file.
 */
const PHASE_3_OPTIONS: readonly SlashMenuOption[] = [
  // Media
  {
    id: 'media:image',
    type: 'image',
    get label() {
      return i18n.t('editor.slashMenu.image.label');
    },
    get description() {
      return i18n.t('editor.slashMenu.image.description');
    },
    get keywords() {
      return searchTerms(
        i18n.t('editor.slashMenu.image.label', EN),
        i18n.t('editor.slashMenu.image.keywords', EN),
        i18n.t('editor.slashMenu.image.keywords'),
      );
    },
    section: 'media',
    Icon: ImageIcon,
  },
  {
    id: 'media:video',
    type: 'video',
    get label() {
      return i18n.t('editor.slashMenu.video.label');
    },
    get description() {
      return i18n.t('editor.slashMenu.video.description');
    },
    get keywords() {
      return searchTerms(
        i18n.t('editor.slashMenu.video.label', EN),
        i18n.t('editor.slashMenu.video.keywords', EN),
        i18n.t('editor.slashMenu.video.keywords'),
      );
    },
    section: 'media',
    Icon: VideoIcon,
  },
  {
    id: 'media:audio',
    type: 'audio',
    get label() {
      return i18n.t('editor.slashMenu.audio.label');
    },
    get description() {
      return i18n.t('editor.slashMenu.audio.description');
    },
    get keywords() {
      return searchTerms(
        i18n.t('editor.slashMenu.audio.label', EN),
        i18n.t('editor.slashMenu.audio.keywords', EN),
        i18n.t('editor.slashMenu.audio.keywords'),
      );
    },
    section: 'media',
    Icon: Music,
  },
  {
    id: 'media:file',
    type: 'file',
    get label() {
      return i18n.t('editor.slashMenu.file.label');
    },
    get description() {
      return i18n.t('editor.slashMenu.file.description');
    },
    get keywords() {
      return searchTerms(
        i18n.t('editor.slashMenu.file.label', EN),
        i18n.t('editor.slashMenu.file.keywords', EN),
        i18n.t('editor.slashMenu.file.keywords'),
      );
    },
    section: 'media',
    Icon: FileIcon,
  },
  {
    id: 'media:pdf',
    type: 'pdf',
    get label() {
      return i18n.t('editor.slashMenu.pdf.label');
    },
    get description() {
      return i18n.t('editor.slashMenu.pdf.description');
    },
    get keywords() {
      return searchTerms(
        i18n.t('editor.slashMenu.pdf.label', EN),
        i18n.t('editor.slashMenu.pdf.keywords', EN),
        i18n.t('editor.slashMenu.pdf.keywords'),
      );
    },
    section: 'media',
    Icon: FileText,
  },

  // Embeds
  {
    id: 'embeds:bookmark',
    type: 'bookmark',
    get label() {
      return i18n.t('editor.slashMenu.bookmark.label');
    },
    get description() {
      return i18n.t('editor.slashMenu.bookmark.description');
    },
    get keywords() {
      return searchTerms(
        i18n.t('editor.slashMenu.bookmark.label', EN),
        i18n.t('editor.slashMenu.bookmark.keywords', EN),
        i18n.t('editor.slashMenu.bookmark.keywords'),
      );
    },
    section: 'embeds',
    Icon: Bookmark,
  },
  {
    id: 'embeds:embed',
    type: 'embed',
    get label() {
      return i18n.t('editor.slashMenu.embed.label');
    },
    get description() {
      return i18n.t('editor.slashMenu.embed.description');
    },
    get keywords() {
      return searchTerms(
        i18n.t('editor.slashMenu.embed.label', EN),
        i18n.t('editor.slashMenu.embed.keywords', EN),
        i18n.t('editor.slashMenu.embed.keywords'),
      );
    },
    section: 'embeds',
    Icon: ExternalLink,
  },
  {
    id: 'embeds:youtube',
    type: 'video',
    get label() {
      return i18n.t('editor.slashMenu.youtube.label');
    },
    get description() {
      return i18n.t('editor.slashMenu.youtube.description');
    },
    get keywords() {
      return searchTerms(
        i18n.t('editor.slashMenu.youtube.label', EN),
        i18n.t('editor.slashMenu.youtube.keywords', EN),
        i18n.t('editor.slashMenu.youtube.keywords'),
      );
    },
    section: 'embeds',
    Icon: VideoIcon,
  },

  // Advanced — layout, interactive, math
  {
    id: 'advanced:columns',
    type: 'columns',
    get label() {
      return i18n.t('editor.slashMenu.columns.label');
    },
    get description() {
      return i18n.t('editor.slashMenu.columns.description');
    },
    get keywords() {
      return searchTerms(
        i18n.t('editor.slashMenu.columns.label', EN),
        i18n.t('editor.slashMenu.columns.keywords', EN),
        i18n.t('editor.slashMenu.columns.keywords'),
      );
    },
    section: 'advanced',
    Icon: Rows3,
  },
  {
    id: 'advanced:table',
    type: 'table',
    get label() {
      return i18n.t('editor.slashMenu.table.label');
    },
    get description() {
      return i18n.t('editor.slashMenu.table.description');
    },
    get keywords() {
      return searchTerms(
        i18n.t('editor.slashMenu.table.label', EN),
        i18n.t('editor.slashMenu.table.keywords', EN),
        i18n.t('editor.slashMenu.table.keywords'),
      );
    },
    section: 'advanced',
    Icon: TableIcon,
  },
  {
    id: 'advanced:button',
    type: 'button',
    get label() {
      return i18n.t('editor.slashMenu.button.label');
    },
    get description() {
      return i18n.t('editor.slashMenu.button.description');
    },
    get keywords() {
      return searchTerms(
        i18n.t('editor.slashMenu.button.label', EN),
        i18n.t('editor.slashMenu.button.keywords', EN),
        i18n.t('editor.slashMenu.button.keywords'),
      );
    },
    section: 'advanced',
    Icon: SquareDashedBottom,
  },
  {
    id: 'advanced:link_to_page',
    type: 'link_to_page',
    get label() {
      return i18n.t('editor.slashMenu.linkToPage.label');
    },
    get description() {
      return i18n.t('editor.slashMenu.linkToPage.description');
    },
    get keywords() {
      return searchTerms(
        i18n.t('editor.slashMenu.linkToPage.label', EN),
        i18n.t('editor.slashMenu.linkToPage.keywords', EN),
        i18n.t('editor.slashMenu.linkToPage.keywords'),
      );
    },
    section: 'advanced',
    Icon: Link2,
  },
  {
    id: 'advanced:equation',
    type: 'equation',
    get label() {
      return i18n.t('editor.slashMenu.equation.label');
    },
    get description() {
      return i18n.t('editor.slashMenu.equation.description');
    },
    get keywords() {
      return searchTerms(
        i18n.t('editor.slashMenu.equation.label', EN),
        i18n.t('editor.slashMenu.equation.keywords', EN),
        i18n.t('editor.slashMenu.equation.keywords'),
      );
    },
    section: 'advanced',
    Icon: Calculator,
  },
  {
    id: 'advanced:mermaid',
    type: 'mermaid',
    get label() {
      return i18n.t('editor.slashMenu.mermaid.label');
    },
    get description() {
      return i18n.t('editor.slashMenu.mermaid.description');
    },
    get keywords() {
      return searchTerms(
        i18n.t('editor.slashMenu.mermaid.label', EN),
        i18n.t('editor.slashMenu.mermaid.keywords', EN),
        i18n.t('editor.slashMenu.mermaid.keywords'),
      );
    },
    section: 'advanced',
    Icon: Workflow,
  },
  {
    id: 'advanced:table_of_contents',
    type: 'table_of_contents',
    get label() {
      return i18n.t('editor.slashMenu.tableOfContents.label');
    },
    get description() {
      return i18n.t('editor.slashMenu.tableOfContents.description');
    },
    get keywords() {
      return searchTerms(
        i18n.t('editor.slashMenu.tableOfContents.label', EN),
        i18n.t('editor.slashMenu.tableOfContents.keywords', EN),
        i18n.t('editor.slashMenu.tableOfContents.keywords'),
      );
    },
    section: 'advanced',
    Icon: ListTree,
  },
  {
    id: 'advanced:breadcrumb',
    type: 'breadcrumb',
    get label() {
      return i18n.t('editor.slashMenu.breadcrumb.label');
    },
    get description() {
      return i18n.t('editor.slashMenu.breadcrumb.description');
    },
    get keywords() {
      return searchTerms(
        i18n.t('editor.slashMenu.breadcrumb.label', EN),
        i18n.t('editor.slashMenu.breadcrumb.keywords', EN),
        i18n.t('editor.slashMenu.breadcrumb.keywords'),
      );
    },
    section: 'advanced',
    Icon: MapPin,
  },
  {
    id: 'advanced:sync_block',
    type: 'sync_block',
    get label() {
      return i18n.t('editor.slashMenu.syncedBlock.label');
    },
    get description() {
      return i18n.t('editor.slashMenu.syncedBlock.description');
    },
    get keywords() {
      return searchTerms(
        i18n.t('editor.slashMenu.syncedBlock.label', EN),
        i18n.t('editor.slashMenu.syncedBlock.keywords', EN),
        i18n.t('editor.slashMenu.syncedBlock.keywords'),
      );
    },
    section: 'advanced',
    Icon: RefreshCcw,
  },
];

/**
 * Translated text for the editor's built-in entries. The registry dedupes by
 * id and keeps the built-in position, so re-registering these ids swaps only
 * their text; the type, section and icon still come from the editor's own
 * definition.
 */
const DEFAULT_TEXT: Record<string, LocalizedText> = {
  'basic:paragraph': {
    get label() {
      return i18n.t('editor.slashMenu.paragraph.label');
    },
    get description() {
      return i18n.t('editor.slashMenu.paragraph.description');
    },
    get keywords() {
      return searchTerms(
        i18n.t('editor.slashMenu.paragraph.label', EN),
        i18n.t('editor.slashMenu.paragraph.keywords', EN),
        i18n.t('editor.slashMenu.paragraph.keywords'),
      );
    },
  },
  'basic:heading_1': {
    get label() {
      return i18n.t('editor.slashMenu.heading1.label');
    },
    get description() {
      return i18n.t('editor.slashMenu.heading1.description');
    },
    get keywords() {
      return searchTerms(
        i18n.t('editor.slashMenu.heading1.label', EN),
        i18n.t('editor.slashMenu.heading1.keywords', EN),
        i18n.t('editor.slashMenu.heading1.keywords'),
      );
    },
  },
  'basic:heading_2': {
    get label() {
      return i18n.t('editor.slashMenu.heading2.label');
    },
    get description() {
      return i18n.t('editor.slashMenu.heading2.description');
    },
    get keywords() {
      return searchTerms(
        i18n.t('editor.slashMenu.heading2.label', EN),
        i18n.t('editor.slashMenu.heading2.keywords', EN),
        i18n.t('editor.slashMenu.heading2.keywords'),
      );
    },
  },
  'basic:heading_3': {
    get label() {
      return i18n.t('editor.slashMenu.heading3.label');
    },
    get description() {
      return i18n.t('editor.slashMenu.heading3.description');
    },
    get keywords() {
      return searchTerms(
        i18n.t('editor.slashMenu.heading3.label', EN),
        i18n.t('editor.slashMenu.heading3.keywords', EN),
        i18n.t('editor.slashMenu.heading3.keywords'),
      );
    },
  },
  'basic:bulleted_list_item': {
    get label() {
      return i18n.t('editor.slashMenu.bulletedList.label');
    },
    get description() {
      return i18n.t('editor.slashMenu.bulletedList.description');
    },
    get keywords() {
      return searchTerms(
        i18n.t('editor.slashMenu.bulletedList.label', EN),
        i18n.t('editor.slashMenu.bulletedList.keywords', EN),
        i18n.t('editor.slashMenu.bulletedList.keywords'),
      );
    },
  },
  'basic:numbered_list_item': {
    get label() {
      return i18n.t('editor.slashMenu.numberedList.label');
    },
    get description() {
      return i18n.t('editor.slashMenu.numberedList.description');
    },
    get keywords() {
      return searchTerms(
        i18n.t('editor.slashMenu.numberedList.label', EN),
        i18n.t('editor.slashMenu.numberedList.keywords', EN),
        i18n.t('editor.slashMenu.numberedList.keywords'),
      );
    },
  },
  'basic:todo': {
    get label() {
      return i18n.t('editor.slashMenu.todo.label');
    },
    get description() {
      return i18n.t('editor.slashMenu.todo.description');
    },
    get keywords() {
      return searchTerms(
        i18n.t('editor.slashMenu.todo.label', EN),
        i18n.t('editor.slashMenu.todo.keywords', EN),
        i18n.t('editor.slashMenu.todo.keywords'),
      );
    },
  },
  'basic:quote': {
    get label() {
      return i18n.t('editor.slashMenu.quote.label');
    },
    get description() {
      return i18n.t('editor.slashMenu.quote.description');
    },
    get keywords() {
      return searchTerms(
        i18n.t('editor.slashMenu.quote.label', EN),
        i18n.t('editor.slashMenu.quote.keywords', EN),
        i18n.t('editor.slashMenu.quote.keywords'),
      );
    },
  },
  'basic:divider': {
    get label() {
      return i18n.t('editor.slashMenu.divider.label');
    },
    get description() {
      return i18n.t('editor.slashMenu.divider.description');
    },
    get keywords() {
      return searchTerms(
        i18n.t('editor.slashMenu.divider.label', EN),
        i18n.t('editor.slashMenu.divider.keywords', EN),
        i18n.t('editor.slashMenu.divider.keywords'),
      );
    },
  },
  'advanced:code': {
    get label() {
      return i18n.t('editor.slashMenu.code.label');
    },
    get description() {
      return i18n.t('editor.slashMenu.code.description');
    },
    get keywords() {
      return searchTerms(
        i18n.t('editor.slashMenu.code.label', EN),
        i18n.t('editor.slashMenu.code.keywords', EN),
        i18n.t('editor.slashMenu.code.keywords'),
      );
    },
  },
  'advanced:callout': {
    get label() {
      return i18n.t('editor.slashMenu.callout.label');
    },
    get description() {
      return i18n.t('editor.slashMenu.callout.description');
    },
    get keywords() {
      return searchTerms(
        i18n.t('editor.slashMenu.callout.label', EN),
        i18n.t('editor.slashMenu.callout.keywords', EN),
        i18n.t('editor.slashMenu.callout.keywords'),
      );
    },
  },
  'advanced:toggle': {
    get label() {
      return i18n.t('editor.slashMenu.toggle.label');
    },
    get description() {
      return i18n.t('editor.slashMenu.toggle.description');
    },
    get keywords() {
      return searchTerms(
        i18n.t('editor.slashMenu.toggle.label', EN),
        i18n.t('editor.slashMenu.toggle.keywords', EN),
        i18n.t('editor.slashMenu.toggle.keywords'),
      );
    },
  },
};

function localizedDefaults(): SlashMenuOption[] {
  const out: SlashMenuOption[] = [];
  for (const base of SLASH_MENU_OPTIONS) {
    const text = DEFAULT_TEXT[base.id];
    if (!text) continue;
    const option = { ...base };
    // Copy the getters themselves; spreading `text` would freeze today's locale.
    Object.defineProperties(option, Object.getOwnPropertyDescriptors(text));
    out.push(option);
  }
  return out;
}

let registered = false;

/** Idempotent — safe to call repeatedly (slash menu dedupes by id). */
export function registerPhase3SlashMenu(): void {
  if (registered) return;
  registered = true;
  registerSlashMenuOptions(localizedDefaults());
  registerSlashMenuOptions(PHASE_3_OPTIONS);
}

// Side-effect: register on first module import.
registerPhase3SlashMenu();
