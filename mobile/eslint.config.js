// Flat ESLint config: Expo's recommended rules (React, hooks, import resolution, TypeScript).
const expoConfig = require('eslint-config-expo/flat');

module.exports = [
  ...expoConfig,
  { ignores: ['dist/**', 'android/**', 'ios/**', '.expo/**', 'node_modules/**'] },
  {
    // The TypeScript plugin is only registered for TS files by the Expo config, so scope these rules to them.
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      // Unused values are almost always mistakes; underscore-prefixed names are the deliberate exception.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'react-hooks/exhaustive-deps': 'error',
    },
  },
];
