import { validateGraph } from '../js/validation.js';

export function graphToIR(graph) {
  const validationErrors = validateGraph(graph);
  return {
    version: 1,
    agent: graph.metadata.name,
    metadata: structuredClone(graph.metadata),
    inputs: [...(graph.metadata.inputs ?? [])],
    outputs: [...(graph.metadata.outputs ?? [])],
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      label: node.label,
      config: structuredClone(node.config ?? {}),
      x: node.x,
      y: node.y,
      shape: node.shape,
      icon: node.icon
    })),
    connections: graph.connections.map((connection) => ({ ...connection })),
    knowledge: structuredClone(graph.knowledge ?? { facts: [], rules: [] }),
    subAgents: structuredClone(graph.subAgents ?? {}),
    validationErrors
  };
}
