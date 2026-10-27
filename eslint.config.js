const js = require('@eslint/js');

const nodeGlobals = {
  require: 'readonly',
  module: 'writable',
  exports: 'writable',
  process: 'readonly',
  console: 'readonly',
  __dirname: 'readonly',
  __filename: 'readonly',
  Buffer: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  fetch: 'readonly',
  AbortController: 'readonly',
  URL: 'readonly',
};

const jestGlobals = {
  describe: 'readonly',
  test: 'readonly',
  it: 'readonly',
  expect: 'readonly',
  beforeEach: 'readonly',
  afterEach: 'readonly',
  beforeAll: 'readonly',
  afterAll: 'readonly',
  jest: 'readonly',
};

const browserGlobals = {
  window: 'readonly',
  document: 'readonly',
  location: 'readonly',
  fetch: 'readonly',
  console: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  FormData: 'readonly',
  localStorage: 'readonly',
  URLSearchParams: 'readonly',
  Intl: 'readonly',
};

module.exports = [
  js.configs.recommended,
  {
    ignores: ['node_modules/**', 'coverage/**'],
  },
  {
    files: ['*.js', 'src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: nodeGlobals,
    },
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...nodeGlobals, ...jestGlobals },
    },
  },
  {
    files: ['public/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: browserGlobals,
    },
    rules: {
      // Classic multi-<script> SPA: functions/vars declared in one file are
      // called from sibling files and from inline onclick="" attributes that
      // ESLint can't see. Modelling every cross-file global and call site is
      // impractical, so both rules stay off for this directory.
      'no-undef': 'off',
      'no-unused-vars': 'off',
    },
  },
];
