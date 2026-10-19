import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useMediaSource } from '../media-source';

const load = jest.fn();
function Player({ url, playing }: { url: string | null; playing: boolean }) {
  useMediaSource(url, playing, load);
  return null;
}

let renderer: ReactTestRenderer;
beforeEach(() => load.mockClear());
afterEach(() => act(() => renderer.unmount()));

it('loads the first URL at once, and a newer one only while not playing', () => {
  act(() => {
    renderer = create(<Player url={null} playing={false} />);
  });
  expect(load).not.toHaveBeenCalled();
  act(() => renderer.update(<Player url="https://files/a?sig=1" playing={false} />));
  expect(load).toHaveBeenLastCalledWith('https://files/a?sig=1', true);

  // A URL minted while it plays waits: playback is never cut to swap an address.
  act(() => renderer.update(<Player url="https://files/a?sig=1" playing />));
  act(() => renderer.update(<Player url="https://files/a?sig=2" playing />));
  expect(load).toHaveBeenCalledTimes(1);

  // Paused, the player moves to it, keeping its place.
  act(() => renderer.update(<Player url="https://files/a?sig=2" playing={false} />));
  expect(load).toHaveBeenLastCalledWith('https://files/a?sig=2', false);
  expect(load).toHaveBeenCalledTimes(2);

  // The same URL again is nothing to load.
  act(() => renderer.update(<Player url="https://files/a?sig=2" playing={false} />));
  expect(load).toHaveBeenCalledTimes(2);
});
