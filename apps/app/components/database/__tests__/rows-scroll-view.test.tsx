import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { ScrollView } from 'react-native';
import { RowsScrollView } from '../rows-scroll-view';
let renderer: ReactTestRenderer;
afterEach(() => act(() => renderer.unmount()));
it('requests the next page near the end of a vertical scroll, not at the top', () => {
  const load = jest.fn();
  act(() => {
    renderer = create(<RowsScrollView onLoadMore={load} />);
  });
  const scroll = renderer.root.findByType(ScrollView);
  const event = (y: number) => ({
    nativeEvent: {
      contentOffset: { y },
      layoutMeasurement: { height: 400 },
      contentSize: { height: 2000 },
    },
  });
  act(() => scroll.props.onScroll(event(0)));
  expect(load).not.toHaveBeenCalled();
  act(() => scroll.props.onScroll(event(1500)));
  expect(load).toHaveBeenCalledTimes(1);
});
it('fills an undersized viewport so collapsed sub-items do not strand the next page', () => {
  const load = jest.fn();
  act(() => {
    renderer = create(<RowsScrollView onLoadMore={load} />);
  });
  const scroll = renderer.root.findByType(ScrollView);
  act(() => scroll.props.onLayout({ nativeEvent: { layout: { height: 400 } } }));
  act(() => scroll.props.onContentSizeChange(500, 200));
  expect(load).toHaveBeenCalledTimes(1);
  act(() => scroll.props.onContentSizeChange(500, 1000));
  expect(load).toHaveBeenCalledTimes(1);
});
