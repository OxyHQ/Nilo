/**
 * The standard Web Crypto `crypto.getRandomValues`, from `expo-crypto` (Expo's
 * own polyfill), installed before anything else runs: Yjs (through lib0)
 * reads it when it loads, to give each device its id. Imported first by the
 * app's entry (`index.tsx`, `index.web.tsx`); a browser already has it.
 */
import { polyfillWebCrypto } from 'expo-standard-web-crypto';

polyfillWebCrypto();
