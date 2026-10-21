// Worklets' own jest mock. Since Reanimated 4.7 and gesture-handler 3, both
// reach the UI runtime when they load (Reanimated runs a worklet there,
// gesture-handler asks for its holder), which Worklets' JS runtime refuses.
jest.mock('react-native-worklets', () => require('react-native-worklets/src/mock'));
jest.mock('react-native-keyboard-controller', () =>
  require('react-native-keyboard-controller/jest'),
);

// The native media players (`components/editor/blocks/media-players.tsx`):
// their native modules are not in jest. A player that loads and plays nothing.
jest.mock('expo-video', () => {
  const player = () => ({
    playing: false,
    currentTime: 0,
    replace: jest.fn(),
    replaceAsync: jest.fn(() => Promise.resolve()),
    play: jest.fn(),
    pause: jest.fn(),
    addListener: jest.fn(() => ({ remove: jest.fn() })),
    removeListener: jest.fn(),
    release: jest.fn(),
  });
  return {
    useVideoPlayer: jest.fn(player),
    createVideoPlayer: jest.fn(player),
    VideoView: () => null,
  };
});
jest.mock('expo-audio', () => {
  const player = () => ({
    playing: false,
    currentTime: 0,
    replace: jest.fn(),
    seekTo: jest.fn(() => Promise.resolve()),
    play: jest.fn(),
    pause: jest.fn(),
    release: jest.fn(),
  });
  return {
    useAudioPlayer: jest.fn(player),
    createAudioPlayer: jest.fn(player),
    useAudioPlayerStatus: jest.fn(() => ({
      playing: false,
      currentTime: 0,
      duration: 0,
      isLoaded: false,
      didJustFinish: false,
    })),
    setAudioModeAsync: jest.fn(() => Promise.resolve()),
  };
});

// A test reads the app's text by its key, in English, and its colours as none.
// A test that needs other strings or colours mocks the module itself; one that
// needs the real thing `jest.unmock`s it.
jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({
    t: (key, params) => (params ? `${key}:${Object.values(params).join('|')}` : key),
    locale: 'en',
  }),
}));
jest.mock('@/lib/useColorScheme', () => ({ useColorScheme: () => ({ colors: {} }) }));

// AsyncStorage's native module is not in jest: its in-memory mock, for the
// persisted stores (a reader's collapsed groups among them).
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
