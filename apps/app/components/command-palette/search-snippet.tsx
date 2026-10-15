import { Text } from '@/components/ui/text';
import type { SearchSnippetPart } from '@/lib/types/search';
import { snippetRuns } from './search-results';

export function SearchSnippet({ parts }: { parts?: SearchSnippetPart[] }) {
  if (!parts?.length) return null;
  return (
    <Text className="text-xs text-muted-foreground" numberOfLines={2}>
      {snippetRuns(parts).map((run) => (
        <Text
          key={run.key}
          className={run.match ? 'font-semibold text-primary' : 'text-muted-foreground'}
        >
          {run.text}
        </Text>
      ))}
    </Text>
  );
}
