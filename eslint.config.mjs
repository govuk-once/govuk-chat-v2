// @ts-check

import eslint from '@eslint/js';
import { defineConfig, includeIgnoreFile } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import eslintPluginUnicorn from 'eslint-plugin-unicorn';
import tseslint from 'typescript-eslint';
import path from 'node:path';

const gitignorePath = path.join(import.meta.dirname, '.gitignore');

export default defineConfig(
  eslint.configs.recommended,
  tseslint.configs.recommended,
  eslintPluginUnicorn.configs.recommended,
  {
    rules: {
      'unicorn/name-replacements': [
        'error',
        {
          // `props` and `env` are terminology in AWS CDK's own naming.
          replacements: {
            props: false,
            env: false,
          },
        },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          // it's common to have unused args in Lambda functions
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    files: ['services/chat-ui/**/*.{ts,tsx}'],
    extends: [nextVitals],
    settings: {
      next: { rootDir: path.join(import.meta.dirname, 'services/chat-ui') },
    },
  },
  {
    files: ['**/*.test.ts'],
    rules: {
      // Tests can be heavy on the nested calls when using functions as a DSL
      'unicorn/max-nested-calls': 'off',
    },
  },
  includeIgnoreFile(gitignorePath, { name: 'Imported .gitignore patterns' }),
);
