export type EnvironmentRequirement = {
  name: string
  required: boolean
  secret: boolean
  description: string
}

export type LoadedConfiguration = {
  values: Readonly<Record<string, string>>
  missingOptional: readonly string[]
}

export function loadEnvironmentConfiguration(
  requirements: readonly EnvironmentRequirement[],
  environment: NodeJS.ProcessEnv = process.env,
): LoadedConfiguration {
  const values: Record<string, string> = {}
  const missingRequired: string[] = []
  const missingOptional: string[] = []

  for (const requirement of requirements) {
    const value = environment[requirement.name]?.trim()
    if (value) values[requirement.name] = value
    else if (requirement.required) missingRequired.push(requirement.name)
    else missingOptional.push(requirement.name)
  }

  if (missingRequired.length > 0) {
    throw new Error(`missing_environment_configuration:${missingRequired.sort().join(',')}`)
  }

  return { values: Object.freeze(values), missingOptional: Object.freeze(missingOptional.sort()) }
}

export function redactConfiguration(
  configuration: LoadedConfiguration,
  requirements: readonly EnvironmentRequirement[],
): Readonly<Record<string, string>> {
  const secrets = new Set(requirements.filter((requirement) => requirement.secret).map((requirement) => requirement.name))
  return Object.freeze(Object.fromEntries(
    Object.entries(configuration.values).map(([name, value]) => [name, secrets.has(name) ? '[REDACTED]' : value]),
  ))
}
