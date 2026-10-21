import { useMemo } from 'react';
import type { SlashMenuItem } from '@oxy.so/bloom-editor';
import type { BloomIconComponent } from '@oxy.so/bloom/icons';
import { RiArrowRightSLine } from '@oxy.so/bloom/icons/RiArrowRightSLine';
import { RiBookmarkLine } from '@oxy.so/bloom/icons/RiBookmarkLine';
import { RiCheckboxLine } from '@oxy.so/bloom/icons/RiCheckboxLine';
import { RiClipboardLine } from '@oxy.so/bloom/icons/RiClipboardLine';
import { RiCodeBlock } from '@oxy.so/bloom/icons/RiCodeBlock';
import { RiCodeSSlashLine } from '@oxy.so/bloom/icons/RiCodeSSlashLine';
import { RiCursorLine } from '@oxy.so/bloom/icons/RiCursorLine';
import { RiDatabase2Line } from '@oxy.so/bloom/icons/RiDatabase2Line';
import { RiDoubleQuotesL } from '@oxy.so/bloom/icons/RiDoubleQuotesL';
import { RiFileLine } from '@oxy.so/bloom/icons/RiFileLine';
import { RiFilePdf2Line } from '@oxy.so/bloom/icons/RiFilePdf2Line';
import { RiFileTextLine } from '@oxy.so/bloom/icons/RiFileTextLine';
import { RiFlowChart } from '@oxy.so/bloom/icons/RiFlowChart';
import { RiFontSize } from '@oxy.so/bloom/icons/RiFontSize';
import { RiFunctions } from '@oxy.so/bloom/icons/RiFunctions';
import { RiImageLine } from '@oxy.so/bloom/icons/RiImageLine';
import { RiLayoutGridLine } from '@oxy.so/bloom/icons/RiLayoutGridLine';
import { RiLightbulbLine } from '@oxy.so/bloom/icons/RiLightbulbLine';
import { RiLink } from '@oxy.so/bloom/icons/RiLink';
import { RiListOrdered } from '@oxy.so/bloom/icons/RiListOrdered';
import { RiListUnordered } from '@oxy.so/bloom/icons/RiListUnordered';
import { RiLoopRightLine } from '@oxy.so/bloom/icons/RiLoopRightLine';
import { RiRouteLine } from '@oxy.so/bloom/icons/RiRouteLine';
import { RiSubtractLine } from '@oxy.so/bloom/icons/RiSubtractLine';
import { RiTableLine } from '@oxy.so/bloom/icons/RiTableLine';
import { RiText } from '@oxy.so/bloom/icons/RiText';
import { RiVideoLine } from '@oxy.so/bloom/icons/RiVideoLine';
import { RiVolumeUpLine } from '@oxy.so/bloom/icons/RiVolumeUpLine';
import { useTranslation } from '@/hooks/useTranslation';

/** Presentation data only: Bloom owns icon size, paint and suggestion layout. */
const SLASH_ICONS = {
  paragraph: RiText,
  childPage: RiFileTextLine,
  heading1: RiFontSize,
  heading2: RiFontSize,
  heading3: RiFontSize,
  toggleHeading1: RiArrowRightSLine,
  toggleHeading2: RiArrowRightSLine,
  toggleHeading3: RiArrowRightSLine,
  bulletedList: RiListUnordered,
  numberedList: RiListOrdered,
  todo: RiCheckboxLine,
  toggle: RiArrowRightSLine,
  quote: RiDoubleQuotesL,
  callout: RiLightbulbLine,
  divider: RiSubtractLine,
  image: RiImageLine,
  video: RiVideoLine,
  audio: RiVolumeUpLine,
  file: RiFileLine,
  pdf: RiFilePdf2Line,
  bookmark: RiBookmarkLine,
  code: RiCodeBlock,
  columns: RiLayoutGridLine,
  table: RiTableLine,
  syncedBlock: RiLoopRightLine,
  pasteSyncedBlock: RiClipboardLine,
  button: RiCursorLine,
  linkToPage: RiLink,
  equation: RiFunctions,
  mermaid: RiFlowChart,
  tableOfContents: RiListUnordered,
  breadcrumb: RiRouteLine,
  embed: RiCodeSSlashLine,
  youtube: RiVideoLine,
  inlineDatabase: RiDatabase2Line,
  linkedDatabase: RiDatabase2Line,
} satisfies Record<string, BloomIconComponent>;

/** Keywords for search: the catalog's comma-separated list. */
const words = (list: string) =>
  list
    .split(',')
    .map((w) => w.trim())
    .filter(Boolean);

export function useSlashItems(): SlashMenuItem[] {
  const { t } = useTranslation();
  // `t` changes with the language, so the items are re-read with it.
  return useMemo(() => {
    const item = (
      id: keyof typeof SLASH_ICONS,
      label: string,
      description: string,
      keywords: string,
      group: string,
      action: SlashMenuItem['action'],
    ): SlashMenuItem => ({
      id,
      label,
      description,
      keywords: words(keywords),
      group,
      action,
      icon: SLASH_ICONS[id],
    });
    const block = (type: string, props?: Record<string, unknown>) => ({
      kind: 'block' as const,
      type,
      props,
    });
    return [
      item(
        'paragraph',
        t('editor.slashMenu.paragraph.label'),
        t('editor.slashMenu.paragraph.description'),
        t('editor.slashMenu.paragraph.keywords'),
        'basic',
        block('paragraph'),
      ),
      item(
        'childPage',
        t('editor.slashMenu.childPage.label'),
        t('editor.slashMenu.childPage.description'),
        t('editor.slashMenu.childPage.keywords'),
        'basic',
        { kind: 'custom', id: 'childPage' },
      ),
      item(
        'heading1',
        t('editor.slashMenu.heading1.label'),
        t('editor.slashMenu.heading1.description'),
        t('editor.slashMenu.heading1.keywords'),
        'basic',
        block('heading_1'),
      ),
      item(
        'heading2',
        t('editor.slashMenu.heading2.label'),
        t('editor.slashMenu.heading2.description'),
        t('editor.slashMenu.heading2.keywords'),
        'basic',
        block('heading_2'),
      ),
      item(
        'heading3',
        t('editor.slashMenu.heading3.label'),
        t('editor.slashMenu.heading3.description'),
        t('editor.slashMenu.heading3.keywords'),
        'basic',
        block('heading_3'),
      ),
      ...([1, 2, 3] as const).map((level) =>
        item(
          `toggleHeading${level}`,
          t(`editor.slashMenu.toggleHeading${level}.label`),
          t(`editor.slashMenu.toggleHeading${level}.description`),
          t(`editor.slashMenu.toggleHeading${level}.keywords`),
          'basic',
          block(`heading_${level}`, { toggleable: true, expanded: true }),
        ),
      ),
      item(
        'bulletedList',
        t('editor.slashMenu.bulletedList.label'),
        t('editor.slashMenu.bulletedList.description'),
        t('editor.slashMenu.bulletedList.keywords'),
        'basic',
        block('bulleted_list_item'),
      ),
      item(
        'numberedList',
        t('editor.slashMenu.numberedList.label'),
        t('editor.slashMenu.numberedList.description'),
        t('editor.slashMenu.numberedList.keywords'),
        'basic',
        block('numbered_list_item'),
      ),
      item(
        'todo',
        t('editor.slashMenu.todo.label'),
        t('editor.slashMenu.todo.description'),
        t('editor.slashMenu.todo.keywords'),
        'basic',
        block('todo'),
      ),
      item(
        'toggle',
        t('editor.slashMenu.toggle.label'),
        t('editor.slashMenu.toggle.description'),
        t('editor.slashMenu.toggle.keywords'),
        'basic',
        block('toggle'),
      ),
      item(
        'quote',
        t('editor.slashMenu.quote.label'),
        t('editor.slashMenu.quote.description'),
        t('editor.slashMenu.quote.keywords'),
        'basic',
        block('quote'),
      ),
      item(
        'callout',
        t('editor.slashMenu.callout.label'),
        t('editor.slashMenu.callout.description'),
        t('editor.slashMenu.callout.keywords'),
        'basic',
        block('callout'),
      ),
      item(
        'divider',
        t('editor.slashMenu.divider.label'),
        t('editor.slashMenu.divider.description'),
        t('editor.slashMenu.divider.keywords'),
        'basic',
        block('divider'),
      ),
      item(
        'image',
        t('editor.slashMenu.image.label'),
        t('editor.slashMenu.image.description'),
        t('editor.slashMenu.image.keywords'),
        'media',
        block('image'),
      ),
      item(
        'video',
        t('editor.slashMenu.video.label'),
        t('editor.slashMenu.video.description'),
        t('editor.slashMenu.video.keywords'),
        'media',
        block('video'),
      ),
      item(
        'audio',
        t('editor.slashMenu.audio.label'),
        t('editor.slashMenu.audio.description'),
        t('editor.slashMenu.audio.keywords'),
        'media',
        block('audio'),
      ),
      item(
        'file',
        t('editor.slashMenu.file.label'),
        t('editor.slashMenu.file.description'),
        t('editor.slashMenu.file.keywords'),
        'media',
        block('file'),
      ),
      item(
        'pdf',
        t('editor.slashMenu.pdf.label'),
        t('editor.slashMenu.pdf.description'),
        t('editor.slashMenu.pdf.keywords'),
        'media',
        block('pdf'),
      ),
      item(
        'bookmark',
        t('editor.slashMenu.bookmark.label'),
        t('editor.slashMenu.bookmark.description'),
        t('editor.slashMenu.bookmark.keywords'),
        'media',
        block('bookmark'),
      ),
      item(
        'code',
        t('editor.slashMenu.code.label'),
        t('editor.slashMenu.code.description'),
        t('editor.slashMenu.code.keywords'),
        'advanced',
        block('code'),
      ),
      item(
        'columns',
        t('editor.slashMenu.columns.label'),
        t('editor.slashMenu.columns.description'),
        t('editor.slashMenu.columns.keywords'),
        'advanced',
        { kind: 'custom', id: 'columns' },
      ),
      item(
        'table',
        t('editor.slashMenu.table.label'),
        t('editor.slashMenu.table.description'),
        t('editor.slashMenu.table.keywords'),
        'advanced',
        { kind: 'custom', id: 'table' },
      ),
      item(
        'syncedBlock',
        t('editor.slashMenu.syncedBlock.label'),
        t('editor.slashMenu.syncedBlock.description'),
        t('editor.slashMenu.syncedBlock.keywords'),
        'advanced',
        { kind: 'custom', id: 'syncedBlock' },
      ),
      item(
        'pasteSyncedBlock',
        t('editor.slashMenu.pasteSyncedBlock.label'),
        t('editor.slashMenu.pasteSyncedBlock.description'),
        t('editor.slashMenu.pasteSyncedBlock.keywords'),
        'advanced',
        { kind: 'custom', id: 'pasteSyncedBlock' },
      ),
      item(
        'button',
        t('editor.slashMenu.button.label'),
        t('editor.slashMenu.button.description'),
        t('editor.slashMenu.button.keywords'),
        'advanced',
        block('button'),
      ),
      item(
        'linkToPage',
        t('editor.slashMenu.linkToPage.label'),
        t('editor.slashMenu.linkToPage.description'),
        t('editor.slashMenu.linkToPage.keywords'),
        'advanced',
        block('link_to_page'),
      ),
      item(
        'equation',
        t('editor.slashMenu.equation.label'),
        t('editor.slashMenu.equation.description'),
        t('editor.slashMenu.equation.keywords'),
        'advanced',
        block('equation'),
      ),
      item(
        'mermaid',
        t('editor.slashMenu.mermaid.label'),
        t('editor.slashMenu.mermaid.description'),
        t('editor.slashMenu.mermaid.keywords'),
        'advanced',
        block('mermaid'),
      ),
      item(
        'tableOfContents',
        t('editor.slashMenu.tableOfContents.label'),
        t('editor.slashMenu.tableOfContents.description'),
        t('editor.slashMenu.tableOfContents.keywords'),
        'advanced',
        block('table_of_contents'),
      ),
      item(
        'breadcrumb',
        t('editor.slashMenu.breadcrumb.label'),
        t('editor.slashMenu.breadcrumb.description'),
        t('editor.slashMenu.breadcrumb.keywords'),
        'advanced',
        block('breadcrumb'),
      ),
      item(
        'embed',
        t('editor.slashMenu.embed.label'),
        t('editor.slashMenu.embed.description'),
        t('editor.slashMenu.embed.keywords'),
        'embeds',
        block('embed'),
      ),
      item(
        'youtube',
        t('editor.slashMenu.youtube.label'),
        t('editor.slashMenu.youtube.description'),
        t('editor.slashMenu.youtube.keywords'),
        'embeds',
        block('video', { source: 'youtube' }),
      ),
      item(
        'inlineDatabase',
        t('editor.slashMenu.inlineDatabase.label'),
        t('editor.slashMenu.inlineDatabase.description'),
        t('editor.slashMenu.inlineDatabase.keywords'),
        'database',
        { kind: 'custom', id: 'inlineDatabase' },
      ),
      item(
        'linkedDatabase',
        t('editor.slashMenu.linkedDatabase.label'),
        t('editor.slashMenu.linkedDatabase.description'),
        t('editor.slashMenu.linkedDatabase.keywords'),
        'database',
        { kind: 'custom', id: 'linkedDatabase' },
      ),
    ];
  }, [t]);
}
