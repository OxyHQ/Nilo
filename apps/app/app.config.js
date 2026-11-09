/**
 * `app.json`, plus what it cannot say: the app variant (id and name), use
 * Firebase's `google-services.json` (Android push) only when it is there.
 * `google-services.json` is not in
 * the repository; without it, an Android build still works, with no push
 * notifications, instead of failing in `expo prebuild`.
 */
const { existsSync } = require('node:fs');
const { resolve } = require('node:path');

// App variant: a development build sits next to the production app on the same
// device with its own applicationId/bundleId and name. Build it with
// `APP_VARIANT=development`; production is the default. The id is nilo.so
// reversed; Commons' and @oxy.so/services' caller allow-lists hold both.
const IS_DEV_VARIANT = process.env.APP_VARIANT === 'development';
const APP_ID = IS_DEV_VARIANT ? 'so.nilo.app.dev' : 'so.nilo.app';
const APP_NAME = IS_DEV_VARIANT ? 'Nilo (Dev)' : 'Nilo';

module.exports = ({ config }) => {
  config = {
    ...config,
    name: APP_NAME,
    ios: { ...config.ios, bundleIdentifier: APP_ID },
    android: { ...config.android, package: APP_ID },
  };
  const file = config.android?.googleServicesFile;
  if (!file || existsSync(resolve(__dirname, file))) return config;
  console.warn(`[app.config] ${file} is missing: this Android build has no push notifications.`);
  const { googleServicesFile: _missing, ...android } = config.android;
  return { ...config, android };
};
