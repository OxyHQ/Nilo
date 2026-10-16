// The match runs are React Native Text so they inherit the snippet line's size.
import { Text as RunText } from 'react-native';
import { Text } from '@oxy.so/bloom/typography';
import type { SearchSnippetPart } from '@/lib/types/search';
import { snippetRuns } from './search-results';

export function SearchSnippet({ parts }: { parts?: SearchSnippetPart[] }) {
  if (!parts?.length) return null;
  return (
    <Text className="text-xs text-muted-foreground" numberOfLines={2}>
      {snippetRuns(parts).map((run) => (
        <RunText key={run.key} className={run.match ? 'font-semibold text-primary' : undefined}>
          {run.text}
        </RunText>
      ))}
    </Text>
  );
}
