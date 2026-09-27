import { access } from 'node:fs/promises'
import { resolve } from 'node:path'

import type { ValidationIssue, ValidationResult } from '../core/types.js'
import { actionRegistry, integrationRegistry, triggerRegistry, workflowRegistry } from '../registry/index.js'
import { requireCredentialAdapter } from '../integrations/credential-adapters.js'
import { extractEnvironmentReferences, loadPortableWorkflow } from '../runtime/workflow-loader.js'
import { validateN8nWorkflow } from './n8n-workflow-validator.js'
import { ENGINE_ROOT } from '../runtime/paths.js'

async function requireDocument(pathWithAnchor: string, ownerId: string, errors: ValidationIssue[]): Promise<void> {
  const path = pathWithAnchor.split('#', 1)[0]
  if (!path) {
    errors.push({ code: 'missing_documentation_path', message: `${ownerId} has no documentation path.` })
    return
  }
  try {
    await access(resolve(ENGINE_ROOT, path))
  } catch {
    errors.push({ code: 'documentation_not_found', message: `${ownerId} references missing ${path}.` })
  }
}

export async function validateRegistries(): Promise<ValidationResult> {
  const errors: ValidationIssue[] = []
  const warnings: ValidationIssue[] = []

  for (const workflowDefinition of workflowRegistry.list()) {
    await requireDocument(workflowDefinition.documentation, workflowDefinition.id, errors)
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
    for (const workflowId of action.supportedWorkflows) {
      if (!workflowRegistry.get(workflowId)) errors.push({ code: 'unknown_action_workflow', message: `${action.id} references ${workflowId}` })
    }
    for (const integrationId of action.integrationIds) {
      const integration = integrationRegistry.get(integrationId)
      if (!integration) errors.push({ code: 'unknown_action_integration', message: `${action.id} references ${integrationId}` })
      else if (!(integration.supportedActions as readonly string[]).includes(action.id)) {
        errors.push({ code: 'integration_action_mismatch', message: `${action.id} is not declared by ${integrationId}.` })
      }
    }
  }

  for (const trigger of triggerRegistry.list()) {
    for (const workflowId of trigger.supportedWorkflows) {
      if (!workflowRegistry.get(workflowId)) errors.push({ code: 'unknown_trigger_workflow', message: `${trigger.id} references ${workflowId}` })
    }
  }

  for (const integration of integrationRegistry.list()) {
    await requireDocument(integration.documentation, integration.id, errors)
    for (const workflowId of integration.supportedWorkflows) {
      if (!workflowRegistry.get(workflowId)) errors.push({ code: 'unknown_integration_workflow', message: `${integration.id} references ${workflowId}` })
    }
    for (const actionId of integration.supportedActions) {
      if (!actionRegistry.get(actionId)) errors.push({ code: 'unknown_integration_action', message: `${integration.id} references ${actionId}` })
    }
    for (const triggerId of integration.supportedTriggers) {
      if (!triggerRegistry.get(triggerId)) errors.push({ code: 'unknown_integration_trigger', message: `${integration.id} references ${triggerId}` })
    }
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
