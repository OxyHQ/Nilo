import * as React from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { FileText } from 'lucide-react-native';
import { TextFieldInput } from '@oxy.so/bloom/text-field';
import { Text } from '@oxy.so/bloom/typography';
import { useColorScheme } from '@/lib/useColorScheme';
import apiClient from '@/lib/api/client';
import { API_ROUTES } from '@/lib/api/routes';
import { queryKeys } from '@/lib/hooks/query-keys';
import type { PageResponse } from '@/lib/types/pages';
import type { BlockComponentProps } from './types';

const VALID_OBJECT_ID = /^[0-9a-fA-F]{24}$/u;
const PLACEHOLDER_ID = '000000000000000000000000';

/**
 * Inline link to another page. Shows an icon + title once the target page is
 * resolved; otherwise lets the user paste a page id. Clicking routes to the
 * page detail screen.
 */
export function LinkToPageBlock({ block, onChangeContent }: BlockComponentProps) {
  const { colors } = useColorScheme();
  const pageId = typeof block.content.pageId === 'string' ? block.content.pageId : '';
  const isResolved = pageId && pageId !== PLACEHOLDER_ID && VALID_OBJECT_ID.test(pageId);

  const pageQuery = useQuery<PageResponse>({
    queryKey: isResolved ? queryKeys.pages.detail(pageId) : ['pages', 'none'],
    queryFn: async () => {
      const res = await apiClient.get(API_ROUTES.pages.get(pageId));
      return res.data;
    },
    enabled: Boolean(isResolved),
    staleTime: 1000 * 30,
  });

  const [draft, setDraft] = React.useState(pageId);
  const lastBlockId = React.useRef(block.id);
  if (lastBlockId.current !== block.id) {
    lastBlockId.current = block.id;
    setDraft(pageId);
  }

  if (!isResolved) {
    return (
      <View className="rounded-lg border border-dashed border-border bg-muted/40 px-3 py-3 gap-2">
        <View className="flex-row items-center gap-2">
          <FileText size={16} color={colors.mutedForeground} />
          <Text className="text-sm text-muted-foreground">Link to page</Text>
        </View>
        <TextFieldInput
          label="Paste page id (24 hex chars)"
          value={draft}
          onChangeText={setDraft}
          onBlur={() => {
            const trimmed = draft.trim();
            if (VALID_OBJECT_ID.test(trimmed)) {
              onChangeContent({ ...block.content, pageId: trimmed });
            }
          }}
          placeholder="Paste page id (24 hex chars)"
        />
      </View>
    );
  }

  const title = pageQuery.data?.page.title ?? 'Untitled';
  const icon = pageQuery.data?.page.icon ?? null;

  return (
    <Pressable
      onPress={() => router.push(`/p/${pageId}`)}
      className="flex-row items-center gap-2 rounded-md px-2 py-1 hover:bg-muted"
    >
      {icon ? (
        <Text variant="headline-regular">{icon}</Text>
      ) : (
        <FileText size={14} color={colors.foreground} />
      )}
      <Text className="text-sm text-foreground underline" numberOfLines={1}>
        {title}
      </Text>
    </Pressable>
  );
}
