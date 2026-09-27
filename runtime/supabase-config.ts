export type SupabaseRuntimeConfig = {
  url: string
  serviceRoleKey: string
}

export function readSupabaseRuntimeConfig(
  environment: NodeJS.ProcessEnv = process.env,
): SupabaseRuntimeConfig {
  const missing = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].filter(
    (name) => !environment[name]?.trim(),
  )
  if (missing.length) throw new Error(`missing_supabase_environment:${missing.join(',')}`)

  return {
    url: environment.SUPABASE_URL as string,
    serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY as string,
  }
}
