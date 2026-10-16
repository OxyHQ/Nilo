// First: Yjs needs crypto.getRandomValues the moment it loads.
import './lib/polyfills/web-crypto';
import { App } from 'expo-router/build/qualified-entry';
import { renderRootComponent } from 'expo-router/build/renderRootComponent';

renderRootComponent(App);
