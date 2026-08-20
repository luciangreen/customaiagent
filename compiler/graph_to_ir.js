import { validateGraph } from '../js/validation.js';

export function graphToIR(graph, { allowInvalid = false } = {}) {
  const validationErrors = validateGraph(graph);
  if (validationErrors.length && !allowInvalid) {
    const summary = validationErrors.map((error) => `${error.label}: ${error.reason}`).join('; ');
    throw new Error(`Graph validation failed: ${summary}`);
  }
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
