import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'core/pre-crm/n8n-code-nodes/**',
      'core/gtm/acquisition/**',
      'core/revops/contracts/**',
      'integrations/mx-service/**',
      'testing/legacy/**',
      'examples/**',
      'validators/*.cjs',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
)
