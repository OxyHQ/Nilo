import * as React from 'react';
import { View } from 'react-native';
import { Link } from 'expo-router';
import { isEntityId } from '@oxy.so/nilo-contracts';
import { Button, LinkButton } from '@oxy.so/bloom/button';
import { RiFileTextLine } from '@oxy.so/bloom/icons/RiFileTextLine';
import { Text } from '@oxy.so/bloom/typography';
import { IconDisplay } from '@/components/page-chrome/icon-display';
import { useTranslation } from '@/hooks/useTranslation';
import { useColorScheme } from '@/lib/useColorScheme';
import { usePage } from '@/lib/hooks/use-pages';
import { useWorkspaceStore } from '@/lib/stores/workspace-store';
import { PagePicker } from '../page-picker';
import type { BlockComponentProps } from './types';

/** What a block that names no page yet holds (the contract's default). */
const PLACEHOLDER_ID = '000000000000000000000000';

/**
 * Inline link to another page: its icon and title, opening it. A block
 * that names no page yet lets an editor choose one.
 */
export function LinkToPageBlock({ block, onChangeContent, readOnly }: BlockComponentProps) {
  const { t } = useTranslation();
  const { colors } = useColorScheme();
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const [choosing, setChoosing] = React.useState(false);
  const pageId = typeof block.content.pageId === 'string' ? block.content.pageId : '';
  const isResolved = pageId !== PLACEHOLDER_ID && isEntityId(pageId);

  const pageQuery = usePage(isResolved ? pageId : undefined);

  if (!isResolved) {
    return (
      <View className="rounded-lg border border-dashed border-border bg-muted/40 px-3 py-3 gap-2">
        <View className="flex-row items-center gap-2">
          <RiFileTextLine width={16} height={16} fill={colors.mutedForeground} />
          <Text className="text-sm text-muted-foreground">
            {t('editor.blocks.linkToPage.label')}
          </Text>
        </View>
        {readOnly || !workspaceId ? null : (
          <Button
            appearance="outline"
            size="sm"
            className="self-start"
            onPress={() => setChoosing(true)}
          >
            {t('editor.blocks.linkToPage.choose')}
          </Button>
        )}
        {choosing && workspaceId ? (
          <PagePicker
            workspaceId={workspaceId}
            title={t('editor.blocks.linkToPage.choose')}
            onChoose={(page) => onChangeContent({ ...block.content, pageId: page.id })}
            onClose={() => setChoosing(false)}
          />
        ) : null}
      </View>
    );
  }

  // A page the reader cannot open (or that is gone) is not linked to.
  if (pageQuery.isError) {
    return (
      <View className="flex-row items-center gap-2 px-2 py-1">
        <RiFileTextLine width={14} height={14} fill={colors.mutedForeground} />
        <Text className="text-sm text-muted-foreground">
          {t('editor.blocks.linkToPage.missing')}
        </Text>
      </View>
    );
  }

  const page = pageQuery.data?.page;
  return (
    <Link href={`/p/${pageId}`} asChild>
      <LinkButton
        accessibilityRole="link"
        linkTone="text"
        underline="rest"
        textVariant="body-2-regular"
        numberOfLines={1}
        style={{ alignSelf: 'stretch', justifyContent: 'flex-start' }}
        renderLeadingIcon={({ size, color }) =>
          page?.icon ? (
            <IconDisplay value={page.icon} size={size} pageId={pageId} />
          ) : (
            <RiFileTextLine width={size} height={size} fill={color} />
          )
        }
      >
        {page ? page.title || t('pages.untitled') : t('editor.blocks.loading')}
      </LinkButton>
    </Link>
  );
}
