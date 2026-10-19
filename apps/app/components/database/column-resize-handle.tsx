import * as React from 'react';
import { PanResponder, View } from 'react-native';
import { clampWidth } from '@/lib/view-properties';

interface ColumnResizeHandleProps {
  /** The column's width when the drag starts. */
  width: number;
  label: string;
  /** While dragging: the width the column takes. */
  onResize: (width: number) => void;
  /** Released: the width to keep. */
  onCommit: (width: number) => void;
}

/**
 * The right edge of a table column's header, dragged to resize the column
 * (web): its width follows the pointer, within the narrowest and widest a
 * column may be, and is kept when released.
 */
export function ColumnResizeHandle({ width, label, onResize, onCommit }: ColumnResizeHandleProps) {
  const start = React.useRef(width);
  const latest = React.useRef({ width, onResize, onCommit });
  latest.current = { width, onResize, onCommit };
  const responder = React.useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          start.current = latest.current.width;
        },
        onPanResponderMove: (_event, gesture) => {
          latest.current.onResize(clampWidth(start.current + gesture.dx));
        },
        onPanResponderRelease: (_event, gesture) => {
          latest.current.onCommit(clampWidth(start.current + gesture.dx));
        },
        onPanResponderTerminate: (_event, gesture) => {
          latest.current.onCommit(clampWidth(start.current + gesture.dx));
        },
      }),
    [],
  );
  return (
    <View
      accessibilityLabel={label}
      accessibilityRole="adjustable"
      {...responder.panHandlers}
      className="absolute bottom-0 right-0 top-0 hover:bg-primary/40"
      style={{ width: 6, cursor: 'col-resize' } as object}
    />
  );
}
