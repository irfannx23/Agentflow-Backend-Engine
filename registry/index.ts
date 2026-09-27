import { ACTION_DEFINITIONS } from '../actions/catalog.js'
import { INTEGRATION_DEFINITIONS } from '../integrations/catalog.js'
import { TRIGGER_DEFINITIONS } from '../triggers/catalog.js'
import { TypedRegistry } from './typed-registry.js'
import { WORKFLOW_DEFINITIONS } from './workflows.js'

export const workflowRegistry = new TypedRegistry(WORKFLOW_DEFINITIONS)
export const triggerRegistry = new TypedRegistry(TRIGGER_DEFINITIONS)
export const actionRegistry = new TypedRegistry(ACTION_DEFINITIONS)
export const integrationRegistry = new TypedRegistry(INTEGRATION_DEFINITIONS)

export { ACTION_DEFINITIONS, INTEGRATION_DEFINITIONS, TRIGGER_DEFINITIONS, WORKFLOW_DEFINITIONS }
