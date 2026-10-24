const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

/**
 * lib0 (Yjs's foundation) reaches Web Crypto on React Native through
 * `isomorphic-webcrypto`, which needs `expo-random`, gone from Expo since SDK
 * 50. The app installs the standard `crypto.getRandomValues` from expo-crypto
 * at its entry (`lib/polyfills/web-crypto.ts`), so on iOS and Android lib0
 * takes the build browsers take, which reads `globalThis.crypto`.
 */
const LIB0_WEB_CRYPTO = path.join(
  path.dirname(require.resolve('lib0/package.json')),
  'webcrypto.js',
);
const { withNativeWind } = require('nativewind/metro');

module.exports = (() => {
  const config = getDefaultConfig(__dirname);

  // Enable package exports for zod v4 compatibility
  config.resolver.unstable_enablePackageExports = true;

  // Add web-specific resolver settings to handle ESM modules
  config.resolver.sourceExts = [...config.resolver.sourceExts, 'mjs', 'cjs'];

  config.resolver.assetExts = [...config.resolver.assetExts, 'wasm', 'woff2', 'woff'];

  const resolveRequest = config.resolver.resolveRequest;
  config.resolver.resolveRequest = (context, moduleName, platform) => {
    if (moduleName === 'lib0/webcrypto' && platform !== 'web') {
      return { type: 'sourceFile', filePath: LIB0_WEB_CRYPTO };
    }
    return (resolveRequest ?? context.resolveRequest)(context, moduleName, platform);
  };

  return withNativeWind(config, {
    input: './global.css',
    inlineRem: 16,
    inlineVariables: false,
  });
})();
