const globals = require('globals');
const js = require('@eslint/js');

module.exports = [
  js.configs.recommended,
  {
    ignores: ['coverage/**', 'reports/**', 'node_modules/**'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.jest,
        ...globals.node,
        'math': 'readonly',
        'L': 'readonly',
        'JSZip': 'readonly',
        'ExifReader': 'readonly'
      },
    },
    rules: {
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-extend-native': 'error',
      'complexity': ['warn', 10],
      'max-depth': ['warn', 4],
    },
  },
];
