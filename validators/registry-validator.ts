import type { ValidationIssue, ValidationResult } from '../core/types.js'
import { actionRegistry, integrationRegistry, triggerRegistry, workflowRegistry } from '../registry/index.js'
import { requireCredentialAdapter } from '../integrations/credential-adapters.js'
import { extractEnvironmentReferences, loadPortableWorkflow } from '../runtime/workflow-loader.js'
import { validateN8nWorkflow } from './n8n-workflow-validator.js'

export async function validateRegistries(): Promise<ValidationResult> {
  const errors: ValidationIssue[] = []
  const warnings: ValidationIssue[] = []

  for (const workflowDefinition of workflowRegistry.list()) {
    for (const triggerId of workflowDefinition.triggerTypes) {
      if (!triggerRegistry.get(triggerId)) errors.push({ code: 'unknown_trigger', message: `${workflowDefinition.id} references ${triggerId}` })
    }
    for (const integrationId of workflowDefinition.supportedIntegrations) {
      if (!integrationRegistry.get(integrationId)) errors.push({ code: 'unknown_integration', message: `${workflowDefinition.id} references ${integrationId}` })
    }
    for (const credential of workflowDefinition.requiredCredentials) {
      const integration = integrationRegistry.get(credential.integrationId)
      if (!integration) errors.push({ code: 'unknown_credential_integration', message: `${credential.id} references ${credential.integrationId}` })
      else if (!(integration.authentication as readonly string[]).includes(credential.authentication)) {
        errors.push({ code: 'unsupported_credential_authentication', message: `${credential.id} uses unsupported ${credential.authentication} authentication.` })
      }
    }

    if ((workflowDefinition.inputSchema as readonly unknown[]).length === 0 || (workflowDefinition.outputSchema as readonly unknown[]).length === 0) {
      errors.push({ code: 'missing_workflow_schema', message: `${workflowDefinition.id} requires input and output schemas.` })
    }
    if ((workflowDefinition.validation as readonly unknown[]).length === 0 || (workflowDefinition.health.checks as readonly unknown[]).length === 0) {
      errors.push({ code: 'missing_workflow_health_contract', message: `${workflowDefinition.id} requires validation and health checks.` })
    }

    try {
      const workflow = await loadPortableWorkflow(workflowDefinition)
      const validation = validateN8nWorkflow(workflow, { requireRuntimePolicies: true })
      errors.push(...validation.errors.map((entry) => ({ ...entry, path: `${workflowDefinition.id}:${entry.path ?? ''}` })))
      warnings.push(...validation.warnings.map((entry) => ({ ...entry, path: `${workflowDefinition.id}:${entry.path ?? ''}` })))

      const declaredEnvironment = new Set<string>([
        ...workflowDefinition.requiredEnvironmentVariables,
        ...workflowDefinition.optionalEnvironmentVariables,
      ])
      for (const reference of extractEnvironmentReferences(workflow)) {
        if (!declaredEnvironment.has(reference)) {
          errors.push({ code: 'undeclared_environment_variable', message: `${workflowDefinition.id} uses ${reference} without declaring it.` })
        }
      }
    } catch (error) {
      errors.push({ code: 'workflow_load_failed', message: `${workflowDefinition.id}: ${error instanceof Error ? error.message : String(error)}` })
    }
  }

  for (const action of actionRegistry.list()) {
    for (const integrationId of action.integrationIds) {
      if (!integrationRegistry.get(integrationId)) errors.push({ code: 'unknown_action_integration', message: `${action.id} references ${integrationId}` })
    }
  }


  for (const integration of integrationRegistry.list()) {
    try {
      const adapter = requireCredentialAdapter(integration.credentialAdapterId)
      if (adapter.integrationId !== integration.id && adapter.id !== 'none') {
        errors.push({ code: 'credential_adapter_integration_mismatch', message: `${integration.id} uses adapter ${adapter.id} for ${adapter.integrationId}.` })
      }
      for (const secret of integration.secretEnvironmentVariables) {
        if (!(integration.environmentVariables as readonly string[]).includes(secret)) {
          errors.push({ code: 'undeclared_integration_secret', message: `${integration.id} secret ${secret} is not an integration environment variable.` })
        }
      }
    } catch (error) {
      errors.push({ code: 'unknown_credential_adapter', message: `${integration.id}: ${error instanceof Error ? error.message : String(error)}` })
    }
  }

  return { valid: errors.length === 0, errors, warnings }
}
