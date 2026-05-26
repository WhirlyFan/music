import js from '@eslint/js'
import pluginQuery from '@tanstack/eslint-plugin-query'
import prettierConfig from 'eslint-config-prettier'
import prettierPlugin from 'eslint-plugin-prettier'
import reactCompiler from 'eslint-plugin-react-compiler'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import simpleImportSort from 'eslint-plugin-simple-import-sort'
import sonarjs from 'eslint-plugin-sonarjs'
import unicorn from 'eslint-plugin-unicorn'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

// Lint config — mirrors the rule selection from
// ~/usul-policy-research-app/frontend/eslint.config.mjs, adapted for our
// Vite + React stack (the reference is Next-based and uses `eslint-config-next`
// which we don't need). Plugins:
//
//   typescript-eslint (strict)  — TS bug-catchers
//   react-hooks v7              — compiler-powered rules (refs, purity, etc.)
//   react-compiler              — warn on Rules of React violations the
//                                 React Compiler can't optimize through
//   react-refresh               — Fast Refresh sanity
//   @tanstack/query             — query keys + mutation hygiene
//   simple-import-sort          — auto-sorted imports
//   sonarjs / unicorn           — cherry-picked bug-catching rules
//   prettier                    — formatting via lint (auto-fixed by pre-push)
//
// Type-checked rules (`tseslint.configs.strictTypeChecked`) are intentionally
// NOT enabled — they auto-fix into broken code without per-file context.
// Stick to non-type-checked strict.
export default defineConfig([
  globalIgnores(['dist', 'src/routeTree.gen.ts', 'src/lib/api/types.ts']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.strict,
      reactHooks.configs.flat.recommended,
      reactCompiler.configs.recommended,
      reactRefresh.configs.vite,
      ...pluginQuery.configs['flat/recommended'],
      // prettier-config must be last — disables ESLint rules that conflict
      // with Prettier so the prettier-plugin doesn't double-fight them.
      prettierConfig,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    plugins: {
      'simple-import-sort': simpleImportSort,
      prettier: prettierPlugin,
      sonarjs,
      unicorn,
    },
    rules: {
      // ── Auto-fixable formatting (warn — pre-push hook fixes these) ────
      'prettier/prettier': 'warn',
      'simple-import-sort/imports': 'warn',
      'simple-import-sort/exports': 'warn',

      // ── Bug-catching rules (error — block push) ───────────────────────
      'no-console': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../*', '../**/*'],
              message: 'Use @/ path aliases instead of relative parent imports.',
            },
          ],
        },
      ],

      // Core ESLint bug-catchers (no plugins, free)
      'no-constant-binary-expression': 'error',
      'no-useless-assignment': 'error',
      'no-self-compare': 'error',
      'no-template-curly-in-string': 'error',
      'no-promise-executor-return': 'error',

      // SonarJS — logic bug detection (cherry-picked, not full recommended)
      'sonarjs/no-identical-conditions': 'error',
      'sonarjs/no-all-duplicated-branches': 'error',
      'sonarjs/no-collection-size-mischeck': 'error',
      'sonarjs/no-element-overwrite': 'error',
      'sonarjs/no-gratuitous-expressions': 'error',

      // Unicorn — bug-catching subset only
      'unicorn/no-useless-spread': 'error',
      'unicorn/no-invalid-remove-event-listener': 'error',
      'unicorn/no-await-in-promise-methods': 'error',
      'unicorn/throw-new-error': 'error',
      'unicorn/error-message': 'error',

      // TanStack Router file-based routes export both a `Route` object and
      // a component — required by the framework, not a code smell.
      'react-refresh/only-export-components': ['warn', { allowExportNames: ['Route'] }],
    },
  },
  // Vite + tooling config files (vite.config.ts, eslint.config.js) — allow
  // dev-tool imports without the Node globals warnings.
  {
    files: ['*.config.{js,ts,mjs}', 'vite.config.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
])
