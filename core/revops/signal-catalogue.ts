import { REVOPS_SIGNAL_DEFINITIONS } from '../product-signals.js'
import { DATABASE_SIGNAL_DEFINITIONS } from './contracts/database-signals.js'

export type SignalCatalogueEntry = {
  id: string
  category: string
  source: 'runtime-event' | 'database-contract'
  trigger: string
  authority: string
}

export const SIGNAL_CATALOGUE: readonly SignalCatalogueEntry[] = [
  ...REVOPS_SIGNAL_DEFINITIONS.map((definition) => ({
    id: definition.id,
    category: definition.category,
    source: 'runtime-event' as const,
    trigger: definition.triggerCondition,
    authority: 'runtime/signal-engine.ts',
  })),
  ...DATABASE_SIGNAL_DEFINITIONS.map((definition) => ({
    id: definition.definitionId,
    category: definition.category,
    source: 'database-contract' as const,
    trigger: definition.derivation,
    authority: definition.sourceCapability,
  })),
]
