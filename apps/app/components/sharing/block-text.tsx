import { formatMentionDate } from '@/components/page-editor/date-mentions';
import { createContext, useContext } from 'react';
import { Link } from 'expo-router';
import { Text } from '@/components/ui/text';
import { useTranslation } from '@/hooks/useTranslation';
import { usePublicPage } from '@/lib/hooks/use-page-extras';
import type { Segment } from '@/lib/types/pages';
import { openEditorLink } from '@/components/page-editor/open-target';
import { isSafeLink } from '@oxy.so/bloom-text/model';

/** Undefined denotes an authenticated preview; a slug denotes a public site. */
export const PublicMentionContext = createContext<string | undefined>(undefined);

export function blockTextSegments(content: Record<string, unknown>): Segment[] {
  if (Array.isArray(content.segments) && content.segments.length) {
    return content.segments.filter(
      (segment): segment is Segment =>
        segment !== null && typeof segment === 'object' && typeof segment.text === 'string',
    );
  }
  return typeof content.text === 'string' ? [{ text: content.text }] : [];
}

export function BlockText({
  content,
  fallback = '',
}: {
  content: Record<string, unknown>;
  fallback?: string;
}) {
  const segments = blockTextSegments(content);
  if (!segments.some((segment) => segment.text)) return <>{fallback}</>;
  let offset = 0;
  return (
    <>
      {segments
        .filter((segment) => segment.text)
        .map((segment) => {
          const key = offset;
          offset += segment.text.length;
          return <TextSegment key={key} segment={segment} />;
        })}
    </>
  );
}

function TextSegment({ segment }: { segment: Segment }) {
  const slug = useContext(PublicMentionContext);
  const { t, locale } = useTranslation();
  const text = (
    <Text
      inherit
      style={{
        fontWeight: segment.bold ? 'bold' : undefined,
        fontStyle: segment.italic ? 'italic' : undefined,
        textDecorationLine: segment.strike
          ? 'line-through'
          : segment.underline
            ? 'underline'
            : undefined,
      }}
    >
      {segment.mention?.attributes.kind === 'date'
        ? (formatMentionDate(segment.mention.attributes.date, locale) ?? segment.text)
        : segment.text}
    </Text>
  );
  const mention = segment.mention?.attributes;
  if (mention?.kind === 'page' && mention.id) {
    if (slug !== undefined)
      return <PublicPageMention slug={slug} id={mention.id} label={segment.text} />;
    return (
      <Link
        href={{ pathname: '/(app)/p/[pageId]', params: { pageId: mention.id } }}
        accessibilityRole="link"
        accessibilityLabel={t('pages.openPage', { title: segment.text })}
        className="text-primary underline"
      >
        {text}
      </Link>
    );
  }
  const href = segment.link;
  if (!mention && href && isSafeLink(href)) {
    return (
      <Text
        inherit
        accessibilityRole="link"
        accessibilityLabel={segment.text}
        className="text-primary underline"
        onPress={() => openEditorLink(href)}
      >
        {text}
      </Text>
    );
  }
  return text;
}

function PublicPageMention({ slug, id, label }: { slug: string; id: string; label: string }) {
  // The anonymous public endpoint is the authority for publication, including
  // inherited publication and restrictions. Never consult authenticated data here.
  const target = usePublicPage(slug, id);
  const { t } = useTranslation();
  if (target.isError || !target.data) return <Text inherit>{label}</Text>;
  return (
    <Link
      href={{ pathname: '/pub/[slug]/[pageId]', params: { slug, pageId: id } }}
      accessibilityRole="link"
      accessibilityLabel={t('pages.openPage', { title: label })}
      className="text-primary underline"
    >
      {label}
    </Link>
  );
}
