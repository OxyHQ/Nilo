/**
 * `app.json`, plus what it cannot say: use Firebase's `google-services.json`
 * (Android push) only when it is there, and bundle development builds with
 * Noxcturnal. `google-services.json` is not in the repository; without it, an
 * Android build still works, with no push notifications, instead of failing in
 * `expo prebuild`.
 */
const { existsSync } = require('node:fs');
const { resolve } = require('node:path');

module.exports = ({ config }) => {
  const experiments = {
    ...config.experiments,
    // Expo's oxc transformer, about 2x faster cold bundles than Babel. Development
    // only: in a production export it keeps the requires of dead platform branches
    // (`if (Platform.OS !== 'web') require(...)`), pulling native-only packages into
    // the web bundle. The CLI sets NODE_ENV before it reads this config.
    noxcturnalTransformWorker: process.env.NODE_ENV !== 'production',
  };
  const file = config.android?.googleServicesFile;
  if (!file || existsSync(resolve(__dirname, file))) return { ...config, experiments };
  console.warn(`[app.config] ${file} is missing: this Android build has no push notifications.`);
  const { googleServicesFile: _missing, ...android } = config.android;
  return { ...config, experiments, android };
};
