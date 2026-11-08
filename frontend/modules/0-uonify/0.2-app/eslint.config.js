import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

// Reglas de la casa: archivos de 500 líneas como máximo (también CSS, con
// scripts/check-lines.mjs) y módulos que solo se hablan por su index.ts.
export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'public', 'coverage'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { ecmaVersion: 2023, globals: { ...globals.browser, ...globals.node } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'max-lines': ['error', { max: 500, skipBlankLines: false, skipComments: false }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['@/modules/*/*', '@/modules/*/**'],
          message: 'Importa otro módulo solo por su index.ts: @/modules/<módulo>.',
        }],
      }],
    },
  },
);
