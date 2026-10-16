/**
 * The app's jest configuration.
 *
 * `testTimeout`: React Native exports its components through lazy `require`s,
 * so the first render in a test file transforms much of React Native and its
 * libraries. With Babel's cache cold — CI after any lockfile change — on a
 * two-core runner that took over jest's default 5 s inside the first test of a
 * file; with the cache warm the same test takes under 200 ms.
 */
module.exports = {
  preset: 'jest-expo',
  testTimeout: 30_000,
  // Worklets' own resolver picks its JS (non-.native) runtime, so the real
  // Reanimated that Bloom's components animate with loads without the native
  // module.
  resolver: require.resolve('react-native-worklets/jest/resolver'),
  // Bloom's sheets and swipeable surfaces are gesture-handler views.
  setupFiles: ['react-native-gesture-handler/jestSetup'],
  // As in Metro (metro.config.js): lib0 takes its standard Web Crypto build,
  // which Node provides, not the React Native one that needs expo-random.
  moduleNameMapper: {
    '^lib0/webcrypto$': '<rootDir>/../../node_modules/lib0/dist/webcrypto.cjs',
  },
  transformIgnorePatterns: [
    '/node_modules/(?!(.pnpm|react-native|@react-native|@react-native-community|expo|@expo|@expo-google-fonts|react-navigation|@react-navigation|@sentry/react-native|native-base|standard-navigation|@oxy\\.so))',
    '/node_modules/react-native-reanimated/plugin/',
    '/node_modules/@react-native/babel-preset/',
  ],
};
