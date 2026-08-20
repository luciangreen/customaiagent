import { graphToIR } from '../compiler/graph_to_ir.js';

const BUILTINS = {
  contains(haystack, needle) {
    return { success: String(haystack ?? '').includes(String(needle ?? '')) };
  },
  equals(left, right) {
    return { success: left === right };
  },
  greater_than(left, right) {
    return { success: Number(left) > Number(right) };
  },
  add(left, right) {
    return { success: true, result: Number(left) + Number(right) };
  },
  concat(left, right) {
    return { success: true, result: `${left ?? ''}${right ?? ''}` };
  },
  identity(value) {
    return { success: true, result: value };
  }
};

function clone(value) {
  return structuredClone(value);
}

function getNode(ir, nodeId) {
  return ir.nodes.find((node) => node.id === nodeId);
}

function getNextConnection(ir, nodeId, kinds) {
  return ir.connections.find((connection) => connection.from === nodeId && kinds.includes(connection.kind)) ?? null;
}

function normalizeInput(ir, input) {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    return clone(input);
  }
  const firstInput = ir.inputs?.[0] ?? 'input';
  return { [firstInput]: input };
}

function isVariableToken(value) {
  return typeof value === 'string' && value.startsWith('$');
}

function resolveValue(value, variables) {
  if (isVariableToken(value)) {
    return variables[value.slice(1)];
  }
  return value;
}

function renderTemplate(template = '', variables = {}) {
  return String(template).replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g, (_match, name) => {
    const replacement = variables[name];
    return replacement === undefined || replacement === null ? '' : String(replacement);
  });
}

function validateStructuredResponse(schemaText, response) {
  if (!schemaText) {
    return { valid: true };
  }
  let schema;
  try {
    schema = typeof schemaText === 'string' ? JSON.parse(schemaText) : schemaText;
  } catch (error) {
    return { valid: false, error: `Structured schema is invalid JSON: ${error.message}` };
  }
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    return { valid: false, error: 'Structured response must be an object.' };
  }
  for (const [key, type] of Object.entries(schema)) {
    const actual = response[key];
    if (type === 'string' && typeof actual !== 'string') {
      return { valid: false, error: `Field ${key} must be a string.` };
    }
    if (type === 'number' && typeof actual !== 'number') {
      return { valid: false, error: `Field ${key} must be a number.` };
    }
    if (type === 'boolean' && typeof actual !== 'boolean') {
      return { valid: false, error: `Field ${key} must be a boolean.` };
    }
  }
  return { valid: true };
}

function matchFact(fact, args) {
  const bindings = {};
  for (let index = 0; index < fact.args.length; index += 1) {
    const expected = fact.args[index];
    const actual = args[index];
    if (actual && actual.__output) {
      bindings[actual.name] = expected;
      continue;
    }
    if (isVariableToken(expected)) {
      bindings[expected.slice(1)] = actual;
      continue;
    }
    if (expected !== actual) {
      return null;
    }
  }
  return bindings;
}

function resolveRuleArgument(argument, env) {
  if (isVariableToken(argument)) {
    return env[argument.slice(1)] ?? { __output: true, name: argument.slice(1) };
  }
  return argument;
}

function executeBuiltin(predicate, values) {
  const builtin = BUILTINS[predicate];
  if (!builtin) {
    return null;
  }
  const result = builtin(...values);
  return result ?? { success: false };
}

function executeKnowledgePredicate(ir, predicate, args, context, depth = 0) {
  if (depth > 12) {
    return { success: false, error: 'Predicate recursion limit exceeded.' };
  }
  const builtinResult = executeBuiltin(predicate, args.map((arg) => (arg && arg.__output ? undefined : arg)));
  if (builtinResult) {
    const output = args.find((arg) => arg && arg.__output);
    const bindings = {};
    if (output && builtinResult.result !== undefined) {
      bindings[output.name] = builtinResult.result;
    }
    return { success: builtinResult.success !== false, bindings };
  }

  for (const fact of ir.knowledge?.facts ?? []) {
    if (fact.predicate !== predicate) {
      continue;
    }
    const bindings = matchFact(fact, args);
    if (bindings) {
      return { success: true, bindings };
    }
  }

  for (const rule of ir.knowledge?.rules ?? []) {
    if (rule.head?.predicate !== predicate) {
      continue;
    }
    const env = {};
    let headMatches = true;
    for (let index = 0; index < (rule.head.args ?? []).length; index += 1) {
      const headArg = rule.head.args[index];
      const callArg = args[index];
      if (isVariableToken(headArg)) {
        const key = headArg.slice(1);
        if (callArg && callArg.__output) {
          env[key] = callArg;
        } else {
          env[key] = callArg;
        }
        continue;
      }
      if (headArg !== callArg) {
        headMatches = false;
        break;
      }
    }
    if (!headMatches) {
      continue;
    }
    let bodySuccess = true;
    for (const goal of rule.body ?? []) {
      const goalArgs = (goal.args ?? []).map((argument) => resolveRuleArgument(argument, env));
      const result = executeKnowledgePredicate(ir, goal.predicate, goalArgs, context, depth + 1);
      if (!result.success) {
        bodySuccess = false;
        break;
      }
      Object.assign(env, result.bindings ?? {});
    }
    if (bodySuccess) {
      const bindings = {};
      for (let index = 0; index < (rule.head.args ?? []).length; index += 1) {
        const headArg = rule.head.args[index];
        const callArg = args[index];
        if (callArg && callArg.__output && isVariableToken(headArg)) {
          bindings[callArg.name] = env[headArg.slice(1)];
        }
      }
      return { success: true, bindings };
    }
  }
  return { success: false };
}

async function invokePredicate(ir, node, state, options) {
  const args = (node.config?.args ?? []).map((argument) => {
    if (isVariableToken(argument)) {
      const variableName = argument.slice(1);
      if ((node.config?.outputVariables ?? []).includes(variableName)) {
        return { __output: true, name: variableName };
      }
      return state.variables[variableName];
    }
    return argument;
  });

  const predicateName = node.config?.predicate;
  const customPredicate = options.predicateRegistry?.[predicateName];
  if (customPredicate) {
    const result = await customPredicate({ args, state: clone(state), ir, node });
    if (result?.bindings) {
      Object.assign(state.variables, result.bindings);
    }
    return { success: Boolean(result?.success), branch: result?.success ? 'success' : 'failure' };
  }

  const result = executeKnowledgePredicate(ir, predicateName, args, { state, options });
  if (result.success && result.bindings) {
    Object.assign(state.variables, result.bindings);
  }
  return { success: result.success, branch: result.success ? 'success' : 'failure', error: result.error };
}

async function invokeLLM(ir, node, state, options) {
  const prompt = renderTemplate(node.config?.promptTemplate, state.variables);
  const payload = {
    model: node.config?.model || ir.metadata?.llmProfile || 'mock-default',
    systemPrompt: node.config?.systemPrompt || '',
    prompt,
    variables: clone(state.variables),
    nodeId: node.id,
    mockResponse: node.config?.mockResponse
  };
  const adapter = options.llmAdapter ?? (async (request) => {
    if (request.mockResponse) {
      return request.mockResponse;
    }
    return `Mock response: ${request.prompt}`;
  });

  let attempts = 0;
  const maxAttempts = Math.max(1, Number(node.config?.retryCount ?? 1));
  let lastError = null;
  while (attempts < maxAttempts) {
    attempts += 1;
    try {
      let response = await adapter(payload);
      if (typeof response === 'string' && node.config?.structuredSchema) {
        try {
          response = JSON.parse(response);
        } catch {
          // handled by validator below
        }
      }
      const structured = validateStructuredResponse(node.config?.structuredSchema, response);
      if (!structured.valid) {
        lastError = structured.error;
        continue;
      }
      state.variables[node.config?.outputVariable || 'response'] = response;
      return { success: true, prompt, response };
    } catch (error) {
      lastError = error.message;
    }
  }
  return { success: false, prompt, error: lastError ?? 'LLM call failed.' };
}

async function invokeTool(node, state, options) {
  const request = renderTemplate(node.config?.requestTemplate, state.variables);
  const adapter = options.toolAdapter ?? (async (toolName, toolRequest) => {
    if (toolName === 'calculator') {
      if (!/^[0-9+\-*/ ().]+$/.test(toolRequest)) {
        throw new Error('Calculator only supports arithmetic input.');
      }
      return Function(`"use strict"; return (${toolRequest});`)();
    }
    return { tool: toolName, request: toolRequest };
  });
  const response = await adapter(node.config?.tool, request, { variables: clone(state.variables) });
  state.variables[node.config?.outputVariable || 'toolResult'] = response;
  return { success: true, response };
}

async function invokeMemory(node, state) {
  const scope = node.config?.scope || 'session';
  state.memory[scope] ??= {};
  const bucket = state.memory[scope];
  const key = node.config?.key || 'memory';
  const resolvedValue = resolveValue(node.config?.value, state.variables);
  switch (node.config?.operation) {
    case 'read':
      state.variables[node.config?.outputVariable || 'memoryValue'] = clone(bucket[key]);
      return { success: true, response: bucket[key] };
    case 'write':
      bucket[key] = resolvedValue;
      return { success: true, response: bucket[key] };
    case 'append':
      bucket[key] = Array.isArray(bucket[key]) ? bucket[key] : bucket[key] === undefined ? [] : [bucket[key]];
      bucket[key].push(resolvedValue);
      return { success: true, response: bucket[key] };
    case 'delete':
      delete bucket[key];
      return { success: true, response: null };
    default:
      return { success: false, error: `Unknown memory operation ${node.config?.operation}.` };
  }
}

async function invokeSubAgent(ir, node, state, options) {
  const agentName = node.config?.agent;
  const registry = { ...(ir.subAgents ?? {}), ...(options.agentRegistry ?? {}) };
  const child = registry[agentName];
  if (!child) {
    return { success: false, error: `Sub-agent ${agentName} is not available.` };
  }
  const childInput = {};
  for (const [name, value] of Object.entries(node.config?.inputMappings ?? {})) {
    childInput[name] = resolveValue(value, state.variables);
  }
  const result = await runAgent(child, childInput, options);
  for (const [name, targetVariable] of Object.entries(node.config?.outputMappings ?? {})) {
    state.variables[targetVariable] = result.output?.[name] ?? result.output;
  }
  return { success: true, response: result.output };
}

async function invokeLoop(ir, node, state, options) {
  const items = state.variables[node.config?.sourceVariable] ?? [];
  if (!Array.isArray(items)) {
    return { success: false, error: 'Loop source variable must be an array.' };
  }
  const results = [];
  for (const item of items) {
    state.variables[node.config?.itemVariable || 'item'] = item;
    if ((node.config?.operation || 'identity') === 'predicate') {
      const predicateNode = {
        ...node,
        type: 'predicate',
        config: {
          predicate: node.config?.predicate,
          args: node.config?.args,
          outputVariables: [node.config?.outputVariable || 'resultItem']
        }
      };
      const result = await invokePredicate(ir, predicateNode, state, options);
      if (!result.success) {
        return result;
      }
      results.push(state.variables[node.config?.outputVariable || 'resultItem']);
    } else if (node.config?.operation === 'subAgent') {
      const subAgentNode = {
        ...node,
        type: 'subAgent',
        config: {
          agent: node.config?.agent,
          inputMappings: { item: `$${node.config?.itemVariable || 'item'}` },
          outputMappings: { result: node.config?.outputVariable || 'resultItem' }
        }
      };
      const result = await invokeSubAgent(ir, subAgentNode, state, options);
      if (!result.success) {
        return result;
      }
      results.push(state.variables[node.config?.outputVariable || 'resultItem']);
    } else {
      results.push(item);
    }
  }
  state.variables[node.config?.targetVariable || 'results'] = results;
  return { success: true, response: results };
}

function decideNext(ir, nodeId, branch = 'control') {
  const priority = branch === 'success'
    ? ['success', 'control']
    : branch === 'failure'
      ? ['failure', 'control']
      : branch === 'true'
        ? ['true']
        : branch === 'false'
          ? ['false']
          : [branch, 'control'];
  const connection = getNextConnection(ir, nodeId, priority);
  return connection?.to ?? null;
}

export async function runAgent(agent, input, options = {}) {
  const ir = agent.agent ? clone(agent) : graphToIR(agent);
  const state = {
    variables: normalizeInput(ir, input),
    memory: clone(options.memory ?? { temporary: {}, session: {}, persistent: {} }),
    trace: []
  };
  const startNode = ir.nodes.find((node) => node.type === 'start');
  if (!startNode) {
    throw new Error('Graph has no Start node.');
  }
  let currentId = startNode.id;
  let steps = 0;
  let status = 'completed';
  const runtimeStates = {};

  while (currentId) {
    steps += 1;
    if (steps > 500) {
      throw new Error('Execution exceeded 500 steps.');
    }
    const node = getNode(ir, currentId);
    if (!node) {
      throw new Error(`Missing node ${currentId}.`);
    }
    runtimeStates[currentId] = 'active';
    const traceEntry = {
      nodeId: node.id,
      label: node.label,
      type: node.type,
      variables: clone(state.variables)
    };

    let result = { success: true };
    switch (node.type) {
      case 'start':
      case 'input':
      case 'end':
        break;
      case 'output':
        if (node.config?.variable) {
          state.variables[node.config.variable] = state.variables[node.config.variable];
        }
        break;
      case 'predicate':
        result = await invokePredicate(ir, node, state, options);
        traceEntry.branch = result.branch;
        break;
      case 'decision': {
        const left = resolveValue(node.config?.left, state.variables);
        const right = resolveValue(node.config?.right, state.variables);
        const operator = node.config?.operator || '==';
        const condition = operator === '==' ? left === right
          : operator === '!=' ? left !== right
            : operator === '>' ? Number(left) > Number(right)
              : operator === '>=' ? Number(left) >= Number(right)
                : operator === '<' ? Number(left) < Number(right)
                  : Number(left) <= Number(right);
        result = { success: true, branch: condition ? 'true' : 'false', response: condition };
        traceEntry.branch = result.branch;
        break;
      }
      case 'llm':
        result = await invokeLLM(ir, node, state, options);
        traceEntry.prompt = result.prompt;
        traceEntry.response = result.response;
        break;
      case 'tool':
        result = await invokeTool(node, state, options);
        traceEntry.response = result.response;
        break;
      case 'memory':
        result = await invokeMemory(node, state, options);
        traceEntry.response = result.response;
        break;
      case 'subAgent':
        result = await invokeSubAgent(ir, node, state, options);
        traceEntry.response = result.response;
        break;
      case 'loop':
        result = await invokeLoop(ir, node, state, options);
        traceEntry.response = result.response;
        break;
      default:
        break;
    }

    traceEntry.variables = clone(state.variables);
    if (!result.success) {
      runtimeStates[currentId] = 'failed';
      traceEntry.error = result.error ?? 'Execution failed.';
      state.trace.push(traceEntry);
      status = 'failed';
      break;
    }
    runtimeStates[currentId] = 'completed';
    state.trace.push(traceEntry);
    if (node.type === 'end') {
      break;
    }
    currentId = decideNext(ir, node.id, result.branch || 'control');
  }

  const output = {};
  for (const name of ir.outputs ?? []) {
    output[name] = state.variables[name];
  }
  return {
    status,
    output,
    variables: state.variables,
    memory: state.memory,
    trace: state.trace,
    runtimeStates
  };
}
