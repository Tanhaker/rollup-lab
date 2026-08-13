/* Flat ESLint config. Dev-only — the site ships no build step and no deps.
   Run with: npx eslint .   (installs eslint on demand)

   The browser scripts are classic <script> files, not modules: they use IIFEs
   and share state through a couple of explicit globals. The config below
   encodes that rather than fighting it. */

const browserGlobals = {
  window: 'readonly', document: 'readonly', navigator: 'readonly',
  localStorage: 'readonly', sessionStorage: 'readonly', fetch: 'readonly',
  console: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly',
  setInterval: 'readonly', clearInterval: 'readonly', performance: 'readonly',
  requestAnimationFrame: 'readonly', IntersectionObserver: 'readonly',
  TextEncoder: 'readonly', CustomEvent: 'readonly', Intl: 'readonly',
  Image: 'readonly', Blob: 'readonly', URL: 'readonly', Worker: 'readonly',
  // this project's own globals
  RollupCore: 'readonly', RollupChain: 'readonly',
  module: 'writable',
};

const nodeGlobals = {
  require: 'readonly', module: 'writable', process: 'readonly',
  console: 'readonly', __dirname: 'readonly',
};

module.exports = [
  {
    files: ['assets/js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: browserGlobals,
    },
    rules: {
      'no-unused-vars': ['warn', { args: 'none' }],
      'no-undef': 'error',
      'no-var': 'off',
      eqeqeq: ['warn', 'smart'],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['tools/**/*.js', 'tests/**/*.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: nodeGlobals,
    },
    rules: { 'no-unused-vars': ['warn', { args: 'none' }] },
  },
];
