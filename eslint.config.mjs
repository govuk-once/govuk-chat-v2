// @ts-check

import eslint from '@eslint/js';
import { defineConfig, includeIgnoreFile } from 'eslint/config';
import eslintPluginUnicorn from 'eslint-plugin-unicorn';
import tseslint from 'typescript-eslint';
import path from "node:path";

const gitignorePath = path.join(import.meta.dirname, ".gitignore");

export default defineConfig(
  eslint.configs.recommended,
  tseslint.configs.recommended,
  eslintPluginUnicorn.configs.recommended,
  {
    rules: {
      "unicorn/name-replacements": [
        "error",
        {
          // `props` and `env` are terminology in AWS CDK's own naming.
          replacements: {
            props: false,
            env: false
          },
        },
      ],
    },
  },
  includeIgnoreFile(gitignorePath, { name: "Imported .gitignore patterns" })
);
