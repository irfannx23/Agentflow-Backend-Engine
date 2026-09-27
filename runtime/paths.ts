import { fileURLToPath } from 'node:url'

export const ENGINE_ROOT = fileURLToPath(new URL('../..', import.meta.url))
