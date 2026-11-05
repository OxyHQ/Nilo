import appJson from '../app.json';

type ExpoConfig = {
  name?: string;
  ios?: { bundleIdentifier?: string };
  android?: { package?: string };
};

function resolveConfig(variant?: string): ExpoConfig {
  const previous = process.env.APP_VARIANT;
  if (variant === undefined) delete process.env.APP_VARIANT;
  else process.env.APP_VARIANT = variant;
  try {
    let expo: ExpoConfig | undefined;
    jest.isolateModules(() => {
      const build = jest.requireActual('../app.config.js') as (context: {
        config: ExpoConfig;
      }) => ExpoConfig;
      expo = build({ config: structuredClone(appJson.expo) as ExpoConfig });
    });
    if (!expo) throw new Error('app.config.js returned no config');
    return expo;
  } finally {
    if (previous === undefined) delete process.env.APP_VARIANT;
    else process.env.APP_VARIANT = previous;
  }
}

it('production is so.nilo.app on both platforms', () => {
  const expo = resolveConfig();
  expect(expo.android?.package).toBe('so.nilo.app');
  expect(expo.ios?.bundleIdentifier).toBe('so.nilo.app');
  expect(expo.name).toBe('Nilo');
});

it('APP_VARIANT=development is so.nilo.app.dev with its own name', () => {
  const expo = resolveConfig('development');
  expect(expo.android?.package).toBe('so.nilo.app.dev');
  expect(expo.ios?.bundleIdentifier).toBe('so.nilo.app.dev');
  expect(expo.name).toBe('Nilo (Dev)');
});
