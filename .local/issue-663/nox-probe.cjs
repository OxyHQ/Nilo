const path = require('node:path');
const root = process.cwd();
const t = require(
  path.join(
    root,
    'node_modules/@expo/metro-config/build/transform-worker/noxcturnal/noxcturnal-transformer.js',
  ),
);
const source =
  'class Base {} var Observer = class extends Base { #result; constructor(){super();this.#result=[];} #read(){return this.#result;} read(){return this.#read();} }; globalThis.observed = new Observer().read();';
const attempt = t.transformFileFullyWithNoxcturnalSync({
  filename: 'node_modules/fixture/index.js',
  source,
  projectRoot: root,
  enableBabelRuntime: false,
  isDefaultExpoTransformer: true,
  hasNonDefaultBabelConfig: false,
  options: {
    type: 'module',
    platform: 'web',
    dev: true,
    hot: false,
    minify: false,
    inlineRequires: false,
    unstable_transformProfile: 'hermes-stable',
    customTransformOptions: { engine: 'hermes' },
  },
  config: {
    allowOptionalDependencies: true,
    asyncRequireModulePath: 'asyncRequire',
    globalPrefix: '',
    unstable_compactOutput: false,
    unstable_disableModuleWrapping: true,
  },
});
console.log(JSON.stringify(attempt, null, 2));
