import { View } from 'react-native';
import { EmptyState } from '@oxy.so/bloom/empty-state';
import type { BlockComponentProps } from './types';

/**
 * `table` container. Children are `table_row` blocks (which themselves
 * contain `table_cell` children). The grid layout is delegated to the
 * editor's child renderer — this component only provides the chrome
 * (border, header tint).
 */
export function TableBlock({ block, renderChildren }: BlockComponentProps) {
  const cols =
    typeof block.content.cols === 'number' && block.content.cols > 0 ? block.content.cols : 2;
  return (
    <View className="rounded-md border border-border overflow-hidden my-1">
      <View accessibilityLabel={`Table with ${cols} columns`} className="bg-background">
        {renderChildren ? (
          renderChildren(block.id)
        ) : (
          <View className="px-3">
            <EmptyState variant="compact" description="Empty table" />
          </View>
        )}
      </View>
    </View>
  );
}
