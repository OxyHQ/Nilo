// Worklets' own jest mock. Since Reanimated 4.7 and gesture-handler 3, both
// reach the UI runtime when they load (Reanimated runs a worklet there,
// gesture-handler asks for its holder), which Worklets' JS runtime refuses.
jest.mock('react-native-worklets', () => require('react-native-worklets/src/mock'));
