import type { ValidationIssue, ValidationResult } from '../core/types.js'
import { actionRegistry, integrationRegistry, triggerRegistry, workflowRegistry } from '../registry/index.js'
import { extractEnvironmentReferences, loadWorkflow } from '../runtime/workflow-loader.js'
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
      if (!integrationRegistry.get(credential.integrationId)) errors.push({ code: 'unknown_credential_integration', message: `${credential.id} references ${credential.integrationId}` })
    }

    try {
      const workflow = await loadWorkflow(workflowDefinition)
      const validation = validateN8nWorkflow(workflow)
      errors.push(...validation.errors.map((entry) => ({ ...entry, path: `${workflowDefinition.id}:${entry.path ?? ''}` })))
      warnings.push(...validation.warnings.map((entry) => ({ ...entry, path: `${workflowDefinition.id}:${entry.path ?? ''}` })))

      const declaredEnvironment = new Set<string>(workflowDefinition.requiredEnvironmentVariables)
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

  return { valid: errors.length === 0, errors, warnings }
}
