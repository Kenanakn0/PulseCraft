import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'test-results', 'playwright-report', 'e2e/screenshots'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      // Hooks kuralları: useEffect bağımlılık dizisi eksikse ya da hook koşullu çağrılırsa
      // uyarır (React öğrenirken en sık yapılan hataları yakalar).
      reactHooks.configs.flat.recommended,
      // Hızlı yenileme (HMR) için: bileşen dosyaları bileşen dışında bir şey dışa aktarmamalı.
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
  },
)
