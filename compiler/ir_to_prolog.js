function escapeAtom(value) {
  return String(value).replace(/'/g, "\\'");
}

function toPrologTerm(value) {
  if (typeof value === 'number') {
    return String(value);
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (value === null || value === undefined) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map(toPrologTerm).join(', ')}]`;
  }
  if (typeof value === 'object') {
    return `'${escapeAtom(JSON.stringify(value))}'`;
  }
  return `'${escapeAtom(value)}'`;
}

function sanitizePredicate(name) {
  return String(name || 'agent').replace(/[^a-zA-Z0-9_]+/g, '_').toLowerCase();
}

function variableName(value, fallback = 'Value') {
  const name = String(value || fallback).replace(/[^a-zA-Z0-9_]+/g, '_');
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function resolveToken(token, varsName = 'Vars0') {
  if (typeof token === 'string' && token.startsWith('$')) {
    const variable = token.slice(1);
    return {
      prelude: `    get_dict(${sanitizePredicate(variable)}, ${varsName}, ${variableName(variable)}),`,
      value: variableName(variable)
    };
  }
  return { prelude: null, value: toPrologTerm(token) };
}

function collectOutputs(node) {
  if (node.type === 'predicate') {
    return node.config?.outputVariables ?? [];
  }
  if (node.type === 'llm' || node.type === 'tool') {
    return node.config?.outputVariable ? [node.config.outputVariable] : [];
  }
  if (node.type === 'memory' && node.config?.operation === 'read') {
    return node.config?.outputVariable ? [node.config.outputVariable] : [];
  }
  if (node.type === 'subAgent') {
    return Object.values(node.config?.outputMappings ?? {});
  }
  if (node.type === 'loop') {
    return node.config?.targetVariable ? [node.config.targetVariable] : [];
  }
  return [];
}

function nextNodeId(ir, nodeId, preferredKinds = ['control']) {
  const connection = ir.connections.find((edge) => edge.from === nodeId && preferredKinds.includes(edge.kind));
  return connection?.to ?? null;
}

function compileFactsAndRules(knowledge) {
  const facts = (knowledge.facts ?? []).map(
    (fact) => `${sanitizePredicate(fact.predicate)}(${(fact.args ?? []).map(toPrologTerm).join(', ')}).`
  );
  const rules = (knowledge.rules ?? []).map((rule) => {
    const headArgs = (rule.head?.args ?? []).map((arg) =>
      typeof arg === 'string' && arg.startsWith('$') ? variableName(arg.slice(1)) : toPrologTerm(arg)
    );
    const head = `${sanitizePredicate(rule.head?.predicate)}(${headArgs.join(', ')})`;
    const body = (rule.body ?? [])
      .map((goal) => {
        const goalArgs = (goal.args ?? []).map((arg) =>
          typeof arg === 'string' && arg.startsWith('$') ? variableName(arg.slice(1)) : toPrologTerm(arg)
        );
        return `${sanitizePredicate(goal.predicate)}(${goalArgs.join(', ')})`;
      })
      .join(',\n    ');
    return `${head} :-\n    ${body}.`;
  });
  return [...facts, ...rules].join('\n\n');
}

function compileNodeStep(ir, node) {
  const nextControl = nextNodeId(ir, node.id, ['control', 'success']);
  const failureTarget = nextNodeId(ir, node.id, ['failure']);
  const trueTarget = nextNodeId(ir, node.id, ['true']);
  const falseTarget = nextNodeId(ir, node.id, ['false']);
  const nextClause = (targetId, inputVar = 'Vars1') =>
    targetId ? `step_${sanitizePredicate(targetId)}(${inputVar}, Vars).` : `Vars = ${inputVar}.`;
  const passthroughClause = (targetId) => (targetId ? `step_${sanitizePredicate(targetId)}(Vars0, Vars).` : 'Vars = Vars0.');

  switch (node.type) {
    case 'start':
    case 'input':
      return `step_${sanitizePredicate(node.id)}(Vars0, Vars) :-\n    ${passthroughClause(nextControl)}`;
    case 'output': {
      const variable = sanitizePredicate(node.config?.variable || ir.outputs?.[0] || 'output');
      return `step_${sanitizePredicate(node.id)}(Vars0, Vars) :-\n    get_dict(${variable}, Vars0, ${variableName(variable)}),\n    put_dict(${variable}, Vars0, ${variableName(variable)}, Vars1),\n    ${nextClause(nextControl)}`;
    }
    case 'predicate': {
      const pieces = (node.config?.args ?? []).map((arg) => resolveToken(arg));
      const prelude = pieces.map((piece) => piece.prelude).filter(Boolean).join('\n');
      const predicate = sanitizePredicate(node.config?.predicate);
      const outputs = collectOutputs(node);
      let currentVar = 'Vars0';
      const updates = outputs.map((name, index) => {
        const targetVar = index === outputs.length - 1 ? 'Vars1' : `VarsMid${index + 1}`;
        const line = `        put_dict(${sanitizePredicate(name)}, ${currentVar}, ${variableName(name)}, ${targetVar})`;
        currentVar = targetVar;
        return line;
      });
      const successContinuation = nextControl
        ? `step_${sanitizePredicate(nextControl)}(Vars1, Vars)`
        : 'Vars = Vars1';
      const failureContinuation = failureTarget
        ? `step_${sanitizePredicate(failureTarget)}(Vars0, Vars)`
        : 'fail';
      const updateBlock = updates.length ? `${updates.join(',\n')},\n` : '        Vars1 = Vars0,\n';
      return `step_${sanitizePredicate(node.id)}(Vars0, Vars) :-\n${prelude ? `${prelude}\n` : ''}    ( ${predicate}(${pieces.map((piece) => piece.value).join(', ')}) ->\n${updateBlock}        ${successContinuation}\n    ;\n        ${failureContinuation}\n    ).`;
    }
    case 'decision': {
      const left = resolveToken(node.config?.left);
      const right = resolveToken(node.config?.right);
      const prelude = [left.prelude, right.prelude].filter(Boolean).join('\n');
      const operatorMap = { '==': '=', '!=': '\\=', '>': '>', '>=': '>=', '<': '<', '<=': '=<' };
      const operator = operatorMap[node.config?.operator] ?? '=';
      return `step_${sanitizePredicate(node.id)}(Vars0, Vars) :-\n${prelude ? `${prelude}\n` : ''}    ( ${left.value} ${operator} ${right.value} ->\n        ${trueTarget ? `step_${sanitizePredicate(trueTarget)}(Vars0, Vars)` : 'Vars = Vars0'}\n    ;\n        ${falseTarget ? `step_${sanitizePredicate(falseTarget)}(Vars0, Vars)` : 'Vars = Vars0'}\n    ).`;
    }
    case 'llm': {
      const inputVariable = node.config?.inputVariables?.[0] || ir.inputs?.[0] || 'input';
      const outputVariable = node.config?.outputVariable || 'response';
      const inputName = variableName(inputVariable);
      const outputName = variableName(outputVariable);
      return `step_${sanitizePredicate(node.id)}(Vars0, Vars) :-\n    get_dict(${sanitizePredicate(inputVariable)}, Vars0, ${inputName}),\n    llm_call(${sanitizePredicate(node.config?.model || 'default')}, ${toPrologTerm(node.config?.systemPrompt || '')}, ${inputName}, [], ${outputName}),\n    put_dict(${sanitizePredicate(outputVariable)}, Vars0, ${outputName}, Vars1),\n    ${nextClause(nextControl)}`;
    }
    case 'memory': {
      const key = toPrologTerm(node.config?.key || 'memory');
      if (node.config?.operation === 'read') {
        const outputVariable = node.config?.outputVariable || 'memory_value';
        return `step_${sanitizePredicate(node.id)}(Vars0, Vars) :-\n    memory_get(${key}, ${variableName(outputVariable)}),\n    put_dict(${sanitizePredicate(outputVariable)}, Vars0, ${variableName(outputVariable)}, Vars1),\n    ${nextClause(nextControl)}`;
      }
      const operation = node.config?.operation === 'append'
        ? `memory_append(${key}, ${toPrologTerm(node.config?.value || '')})`
        : node.config?.operation === 'delete'
          ? `memory_delete(${key})`
          : `memory_put(${key}, ${toPrologTerm(node.config?.value || '')})`;
      return `step_${sanitizePredicate(node.id)}(Vars0, Vars) :-\n    ${operation},\n    ${passthroughClause(nextControl)}`;
    }
    case 'subAgent': {
      const inputEntry = Object.entries(node.config?.inputMappings ?? {})[0] ?? [ir.inputs?.[0] || 'input', '$input'];
      const outputEntry = Object.entries(node.config?.outputMappings ?? {})[0] ?? [ir.outputs?.[0] || 'output', 'output'];
      const input = resolveToken(inputEntry[1]);
      return `step_${sanitizePredicate(node.id)}(Vars0, Vars) :-\n${input.prelude ? `${input.prelude}\n` : ''}    call_agent(${sanitizePredicate(node.config?.agent || 'sub_agent')}, ${input.value}, ${variableName(outputEntry[1])}),\n    put_dict(${sanitizePredicate(outputEntry[1])}, Vars0, ${variableName(outputEntry[1])}, Vars1),\n    ${nextClause(nextControl)}`;
    }
    case 'tool': {
      const outputVariable = node.config?.outputVariable || 'tool_result';
      return `step_${sanitizePredicate(node.id)}(Vars0, Vars) :-\n    tool_call(${sanitizePredicate(node.config?.tool || 'tool')}, ${toPrologTerm(node.config?.requestTemplate || '')}, ${variableName(outputVariable)}),\n    put_dict(${sanitizePredicate(outputVariable)}, Vars0, ${variableName(outputVariable)}, Vars1),\n    ${nextClause(nextControl)}`;
    }
    case 'loop':
      return `step_${sanitizePredicate(node.id)}(Vars0, Vars) :-\n    % Loop nodes are executed by the JavaScript runtime and preserved here as a readable stub.\n    ${passthroughClause(nextControl)}`;
    case 'end':
      return `step_${sanitizePredicate(node.id)}(Vars0, Vars) :-\n    Vars = Vars0.`;
    default:
      return `step_${sanitizePredicate(node.id)}(Vars0, Vars) :-\n    ${passthroughClause(nextControl)}`;
  }
}

export function compileIRToProlog(ir) {
  const moduleName = sanitizePredicate(ir.agent || 'agent');
  const startNode = ir.nodes.find((node) => node.type === 'start');
  const outputVariable = sanitizePredicate(ir.outputs?.[0] || 'output');
  const inputVariable = sanitizePredicate(ir.inputs?.[0] || 'input');
  const knowledge = compileFactsAndRules(ir.knowledge ?? { facts: [], rules: [] });
  const header = [
    `:- module(${moduleName}, [run/2]).`,
    ':- use_module(prolog/agent_runtime).',
    ':- use_module(prolog/llm).',
    ':- use_module(prolog/memory).',
    ':- use_module(prolog/tools).'
  ].join('\n');
  const definition = `agent_definition(${moduleName}, [${(ir.inputs ?? []).map(sanitizePredicate).join(', ')}], [${(ir.outputs ?? []).map(sanitizePredicate).join(', ')}], []).`;
  const runPredicate = [
    'run(Input, Output) :-',
    `    step_${sanitizePredicate(startNode?.id || 'start')}(_{${inputVariable}: Input}, Vars),`,
    `    get_dict(${outputVariable}, Vars, Output).`
  ].join('\n');
  const steps = ir.nodes.map((node) => compileNodeStep(ir, node)).join('\n\n');
  const serialized = JSON.stringify(ir, null, 2).replace(/\\/g, '\\\\').replace(/'/g, "''");
  const sections = [header, definition];
  if (knowledge) {
    sections.push('% Facts and rules');
    sections.push(knowledge);
  }
  sections.push(runPredicate);
  sections.push(steps);
  sections.push(`% Canonical IR\nagent_ir('${serialized}').`);
  return `${sections.join('\n\n')}\n`;
}
