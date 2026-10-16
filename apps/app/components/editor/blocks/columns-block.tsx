import { View } from 'react-native';
import { EmptyState } from '@oxy.so/bloom/empty-state';
import type { BlockComponentProps } from './types';

/**
 * `columns` container — renders its `column` children side-by-side. The
 * editor passes children in via `renderChildren(block.id)`; children are
 * expected to be `column` blocks. Mobile (< 640) collapses to a vertical
 * stack via wrap.
 */
export function ColumnsBlock({ block, renderChildren }: BlockComponentProps) {
  return (
    <View className="flex-row flex-wrap items-stretch gap-1 my-1">
      {renderChildren ? (
        renderChildren(block.id)
      ) : (
        <View className="flex-1 rounded-md border border-dashed border-border bg-muted/30 px-3">
          <EmptyState variant="compact" description="Drop blocks into each column" />
        </View>
      )}
    </View>
  );
}
