import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'src/routeTree.gen.ts', 'src/lib/api/types.ts']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
      prettier, // must be last — disables ESLint rules that conflict with Prettier
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // TanStack Router file-based routes export both a `Route` object and
      // a component — that's required by the framework, not a code smell.
      'react-refresh/only-export-components': ['warn', { allowExportNames: ['Route'] }],
    },
  },
])
