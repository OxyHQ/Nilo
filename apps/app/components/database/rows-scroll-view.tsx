import { useRef, type ComponentProps } from 'react';
import { ScrollView } from 'react-native';

/**
 * The same scroll threshold for the table, list and gallery on native and web.
 * It owns the scroll, layout and content-size callbacks; a caller cannot pass
 * its own and have them silently replaced.
 */
export function RowsScrollView({
  onLoadMore,
  ...props
}: Omit<ComponentProps<typeof ScrollView>, 'onScroll' | 'onLayout' | 'onContentSizeChange'> & {
  onLoadMore?: () => void;
}) {
  const height = useRef(0);
  return (
    <ScrollView
      {...props}
      nestedScrollEnabled
      keyboardShouldPersistTaps="handled"
      scrollEventThrottle={100}
      onLayout={(event) => {
        height.current = event.nativeEvent.layout.height;
      }}
      onContentSizeChange={(_width, contentHeight) => {
        if (height.current > 0 && contentHeight <= height.current) onLoadMore?.();
      }}
      onScroll={({ nativeEvent: { layoutMeasurement, contentOffset, contentSize } }) => {
        if (layoutMeasurement.height + contentOffset.y >= contentSize.height - 200) onLoadMore?.();
      }}
    />
  );
}
