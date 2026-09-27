export type SupabaseRuntimeConfig = {
  url: string
  serviceRoleKey: string
}

export function readSupabaseRuntimeConfig(
  environment: NodeJS.ProcessEnv = process.env,
): SupabaseRuntimeConfig {
  let loaded
  try {
    loaded = loadEnvironmentConfiguration([
      { name: 'SUPABASE_URL', required: true, secret: false, description: 'Supabase project URL.' },
      { name: 'SUPABASE_SERVICE_ROLE_KEY', required: true, secret: true, description: 'Server-side service role credential.' },
    ], environment)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(message.replace('missing_environment_configuration', 'missing_supabase_environment'))
  }

  return {
    url: loaded.values.SUPABASE_URL as string,
    serviceRoleKey: loaded.values.SUPABASE_SERVICE_ROLE_KEY as string,
  }
}
import { loadEnvironmentConfiguration } from './config-loader.js'
