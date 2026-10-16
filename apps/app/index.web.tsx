// First: Yjs needs crypto.getRandomValues the moment it loads.
import './lib/polyfills/web-crypto';
import '@expo/metro-runtime';
import { App } from 'expo-router/build/qualified-entry';
import { renderRootComponent } from 'expo-router/build/renderRootComponent';
import { LoadSkiaWeb } from '@shopify/react-native-skia/lib/module/web';

LoadSkiaWeb({
  locateFile: (file: string) => `/${file}`,
}).then(() => {
  renderRootComponent(App);
});
