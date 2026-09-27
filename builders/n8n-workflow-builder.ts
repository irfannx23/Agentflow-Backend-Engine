import type { N8nConnectionTarget, N8nNode, N8nWorkflow } from '../core/types.js'

export class N8nWorkflowBuilder {
  readonly #nodes = new Map<string, N8nNode>()
  readonly #connections: N8nWorkflow['connections'] = {}

  constructor(readonly name: string) {
    if (!name.trim()) throw new Error('workflow_name_required')
  }

  addNode(node: N8nNode): this {
    if (this.#nodes.has(node.name)) throw new Error(`duplicate_workflow_node:${node.name}`)
    this.#nodes.set(node.name, structuredClone(node))
    return this
  }

  connect(source: string, target: string, sourceOutput = 0, targetInput = 0, type = 'main'): this {
    if (!this.#nodes.has(source)) throw new Error(`unknown_connection_source:${source}`)
    if (!this.#nodes.has(target)) throw new Error(`unknown_connection_target:${target}`)
    const groups = this.#connections[source] ?? {}
    const lanes = groups[type] ?? []
    while (lanes.length <= sourceOutput) lanes.push([])
    const connection: N8nConnectionTarget = { node: target, type, index: targetInput }
    lanes[sourceOutput]!.push(connection)
    groups[type] = lanes
    this.#connections[source] = groups
    return this
  }

  build(): N8nWorkflow {
    if (this.#nodes.size === 0) throw new Error('workflow_requires_node')
    return {
      name: this.name,
      nodes: [...this.#nodes.values()].map((node) => structuredClone(node)),
      connections: structuredClone(this.#connections),
      active: false,
      settings: { executionOrder: 'v1' },
    }
  }
}
