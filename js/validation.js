import { getConnectionsFrom, getConnectionsTo, getReachableNodeIds } from './connections.js';

function collectProducedVariables(graph) {
  const variables = new Set(graph.metadata.inputs ?? []);
  for (const node of graph.nodes) {
    const config = node.config ?? {};
    if (node.type === 'input' && config.variable) {
      variables.add(config.variable);
    }
    if (node.type === 'llm' && config.outputVariable) {
      variables.add(config.outputVariable);
    }
    if (node.type === 'tool' && config.outputVariable) {
      variables.add(config.outputVariable);
    }
    if (node.type === 'memory' && config.operation === 'read' && config.outputVariable) {
      variables.add(config.outputVariable);
    }
    if (node.type === 'predicate') {
      for (const variable of config.outputVariables ?? []) {
        variables.add(variable);
      }
    }
    if (node.type === 'subAgent') {
      for (const variable of Object.values(config.outputMappings ?? {})) {
        variables.add(variable);
      }
    }
    if (node.type === 'loop' && config.targetVariable) {
      variables.add(config.targetVariable);
    }
  }
  return variables;
}

function extractReferencedVariables(value) {
  if (typeof value === 'string') {
    return [...value.matchAll(/\$([A-Za-z_][A-Za-z0-9_]*)/g)].map((match) => match[1]);
  }
  if (Array.isArray(value)) {
    return value.flatMap(extractReferencedVariables);
  }
  if (value && typeof value === 'object') {
    return Object.values(value).flatMap(extractReferencedVariables);
  }
  return [];
}

function parseJsonField(label, raw, errors, nodeId) {
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    errors.push({
      nodeId,
      label,
      reason: `${label} is not valid JSON: ${error.message}`
    });
    return null;
  }
}

function detectSubAgentCycles(graph, errors) {
  const agentNames = new Set([graph.metadata.name, ...Object.keys(graph.subAgents ?? {})]);
  const adjacency = new Map();
  for (const name of agentNames) {
    adjacency.set(name, []);
  }
  for (const node of graph.nodes) {
    if (node.type === 'subAgent' && node.config?.agent) {
      adjacency.get(graph.metadata.name)?.push(node.config.agent);
    }
  }
  for (const [name, subAgent] of Object.entries(graph.subAgents ?? {})) {
    for (const node of subAgent.nodes ?? []) {
      if (node.type === 'subAgent' && node.config?.agent) {
        adjacency.get(name)?.push(node.config.agent);
      }
    }
  }

  const visiting = new Set();
  const visited = new Set();
  const walk = (name) => {
    if (visiting.has(name)) {
      errors.push({ nodeId: null, label: 'Sub-agent', reason: `Recursive sub-agent cycle detected at ${name}.` });
      return;
    }
    if (visited.has(name)) {
      return;
    }
    visiting.add(name);
    for (const next of adjacency.get(name) ?? []) {
      walk(next);
    }
    visiting.delete(name);
    visited.add(name);
  };
  walk(graph.metadata.name);
}

export function validateGraph(graph) {
  const errors = [];
  const starts = graph.nodes.filter((node) => node.type === 'start');
  const ends = graph.nodes.filter((node) => node.type === 'end');

  if (starts.length !== 1) {
    errors.push({ nodeId: starts[0]?.id ?? null, label: 'Start', reason: 'Exactly one Start node is required.' });
  }
  if (ends.length < 1) {
    errors.push({ nodeId: null, label: 'End', reason: 'At least one End node is required.' });
  }

  const reachable = getReachableNodeIds(graph);
  for (const node of graph.nodes) {
    const incoming = getConnectionsTo(graph, node.id);
    const outgoing = getConnectionsFrom(graph, node.id);
    if (node.type !== 'start' && incoming.length === 0) {
      errors.push({ nodeId: node.id, label: node.label, reason: 'Disconnected node without any incoming connection.' });
    }
    if (node.type === 'start' && outgoing.length === 0) {
      errors.push({ nodeId: node.id, label: node.label, reason: 'Start node must connect to another node.' });
    }
    if (node.type !== 'start' && !reachable.has(node.id)) {
      errors.push({ nodeId: node.id, label: node.label, reason: 'Node is unreachable from Start.' });
    }
  }

  const endReachable = ends.some((node) => reachable.has(node.id));
  if (ends.length && !endReachable) {
    errors.push({ nodeId: ends[0].id, label: ends[0].label, reason: 'No End node is reachable from Start.' });
  }

  const producedVariables = collectProducedVariables(graph);
  for (const node of graph.nodes) {
    const config = node.config ?? {};
    const referencedVariables = new Set();
    switch (node.type) {
      case 'predicate':
        for (const arg of config.args ?? []) {
          for (const variable of extractReferencedVariables(arg)) {
            if (!(config.outputVariables ?? []).includes(variable)) {
              referencedVariables.add(variable);
            }
          }
        }
        if (!config.predicate) {
          errors.push({ nodeId: node.id, label: node.label, reason: 'Predicate node requires a predicate name.' });
        }
        break;
      case 'decision':
        extractReferencedVariables({ left: config.left, right: config.right }).forEach((variable) => referencedVariables.add(variable));
        if (!config.operator) {
          errors.push({ nodeId: node.id, label: node.label, reason: 'Decision node requires an operator.' });
        }
        if (!getConnectionsFrom(graph, node.id, 'true').length || !getConnectionsFrom(graph, node.id, 'false').length) {
          errors.push({ nodeId: node.id, label: node.label, reason: 'Decision node requires both true and false branches.' });
        }
        break;
      case 'llm':
        for (const variable of config.inputVariables ?? []) {
          referencedVariables.add(variable);
        }
        if (!config.promptTemplate) {
          errors.push({ nodeId: node.id, label: node.label, reason: 'LLM node requires a prompt template.' });
        }
        parseJsonField('Structured schema', config.structuredSchema, errors, node.id);
        break;
      case 'memory':
        extractReferencedVariables(config.value).forEach((variable) => referencedVariables.add(variable));
        if (!config.key) {
          errors.push({ nodeId: node.id, label: node.label, reason: 'Memory node requires a key.' });
        }
        break;
      case 'subAgent':
        extractReferencedVariables(config.inputMappings).forEach((variable) => referencedVariables.add(variable));
        if (config.agent && !graph.subAgents?.[config.agent]) {
          errors.push({ nodeId: node.id, label: node.label, reason: `Sub-agent ${config.agent} is not defined in this project.` });
        }
        break;
      case 'tool':
        for (const variable of extractReferencedVariables(config.requestTemplate)) {
          referencedVariables.add(variable);
        }
        if (!config.tool) {
          errors.push({ nodeId: node.id, label: node.label, reason: 'Tool node requires a tool name.' });
        }
        break;
      case 'loop':
        if (!config.sourceVariable || !config.targetVariable) {
          errors.push({ nodeId: node.id, label: node.label, reason: 'Loop node requires source and target variables.' });
        }
        referencedVariables.add(config.sourceVariable);
        break;
      case 'output':
        if (config.variable) {
          referencedVariables.add(config.variable);
        }
        break;
      default:
        break;
    }

    for (const variable of referencedVariables) {
      if (!producedVariables.has(variable)) {
        errors.push({ nodeId: node.id, label: node.label, reason: `Variable ${variable} has no producer.` });
      }
    }
  }

  const knowledgePredicates = new Set([
    ...(graph.knowledge?.facts ?? []).map((fact) => fact.predicate),
    ...(graph.knowledge?.rules ?? []).map((rule) => rule.head?.predicate)
  ]);
  for (const node of graph.nodes.filter((item) => item.type === 'predicate')) {
    const predicateName = node.config?.predicate;
    if (!predicateName) {
      continue;
    }
    if (!knowledgePredicates.has(predicateName) && !['contains', 'equals', 'greater_than', 'add', 'identity', 'concat'].includes(predicateName)) {
      errors.push({ nodeId: node.id, label: node.label, reason: `Predicate ${predicateName} is not defined in facts, rules or built-ins.` });
    }
  }

  detectSubAgentCycles(graph, errors);
  return errors;
}
