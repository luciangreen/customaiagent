import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createEmptyGraph } from '../js/nodes.js';
import { validateGraph } from '../js/validation.js';
import { graphToIR } from '../compiler/graph_to_ir.js';
import { compileIRToProlog } from '../compiler/ir_to_prolog.js';
import { compileIRToJavaScript } from '../compiler/ir_to_js.js';
import { runAgent } from '../js/runtime.js';

const schoolAgent = JSON.parse(readFileSync(new URL('../examples/school_agent.json', import.meta.url)));
const classifierAgent = JSON.parse(readFileSync(new URL('../examples/classifier_agent.json', import.meta.url)));

test('create minimal graph and compile to IR', () => {
  const graph = createEmptyGraph('minimal_graph');
  const errors = validateGraph(graph);
  assert.equal(errors.length, 0);
  const ir = graphToIR(graph);
  assert.equal(ir.agent, 'minimal_graph');
  assert.equal(ir.nodes.length, graph.nodes.length);
});

test('save and reload graph JSON', () => {
  const encoded = JSON.stringify(schoolAgent);
  const decoded = JSON.parse(encoded);
  assert.equal(decoded.metadata.name, 'school_agent');
  assert.equal(decoded.connections.length, schoolAgent.connections.length);
});

test('compile IR to readable Prolog and JS', () => {
  const ir = graphToIR(schoolAgent);
  const prolog = compileIRToProlog(ir);
  const js = compileIRToJavaScript(ir);
  assert.match(prolog, /known_answer\(/);
  assert.match(prolog, /llm_call/);
  assert.match(js, /runAgent/);
});

test('execute predicate success path', async () => {
  const result = await runAgent(schoolAgent, { question: 'What is 5 + 6?' });
  assert.equal(result.status, 'completed');
  assert.equal(result.output.answer, '11');
  assert.equal(result.trace.find((entry) => entry.type === 'predicate')?.branch, 'success');
});

test('execute predicate failure with mocked llm fallback', async () => {
  const result = await runAgent(schoolAgent, { question: 'What is a nebula?' });
  assert.equal(result.status, 'completed');
  assert.equal(result.output.answer, 'I do not know that one yet.');
  assert.equal(result.trace.find((entry) => entry.type === 'predicate')?.branch, 'failure');
});

test('decision, loop, memory and tool nodes execute', async () => {
  const graph = {
    version: 1,
    metadata: { name: 'workflow', inputs: ['question', 'items'], outputs: ['answer'] },
    nodes: [
      { id: 'start', type: 'start', label: 'Start', config: {} },
      { id: 'input', type: 'input', label: 'Input', config: { variable: 'question' } },
      { id: 'memoryWrite', type: 'memory', label: 'Save', config: { scope: 'session', operation: 'write', key: 'history', value: '$question', outputVariable: 'history' } },
      { id: 'tool', type: 'tool', label: 'Calc', config: { tool: 'calculator', requestTemplate: '5 + 6', outputVariable: 'sum' } },
      { id: 'loop', type: 'loop', label: 'Loop', config: { sourceVariable: 'items', itemVariable: 'item', targetVariable: 'results', operation: 'identity' } },
      { id: 'decision', type: 'decision', label: 'Check', config: { left: '$sum', operator: '==', right: 11 } },
      { id: 'llm', type: 'llm', label: 'LLM', config: { model: 'mock', systemPrompt: 'Reply', promptTemplate: 'question={{question}}', inputVariables: ['question'], outputVariable: 'answer', mockResponse: 'tool ok', structuredSchema: '', retryCount: 1, errorBehaviour: 'failure' } },
      { id: 'output', type: 'output', label: 'Output', config: { variable: 'answer' } },
      { id: 'end', type: 'end', label: 'End', config: {} }
    ],
    connections: [
      { id: 'c1', from: 'start', to: 'input', kind: 'control' },
      { id: 'c2', from: 'input', to: 'memoryWrite', kind: 'control' },
      { id: 'c3', from: 'memoryWrite', to: 'tool', kind: 'control' },
      { id: 'c4', from: 'tool', to: 'loop', kind: 'control' },
      { id: 'c5', from: 'loop', to: 'decision', kind: 'control' },
      { id: 'c6', from: 'decision', to: 'llm', kind: 'true' },
      { id: 'c7', from: 'decision', to: 'output', kind: 'false' },
      { id: 'c8', from: 'llm', to: 'output', kind: 'control' },
      { id: 'c9', from: 'output', to: 'end', kind: 'control' }
    ],
    knowledge: { facts: [], rules: [] },
    subAgents: {}
  };
  const result = await runAgent(graph, { question: 'hello', items: [1, 2, 3] });
  assert.equal(result.status, 'completed');
  assert.deepEqual(result.variables.results, [1, 2, 3]);
  assert.equal(result.memory.session.history, 'hello');
  assert.equal(result.variables.sum, 11);
});

test('rules and structured llm responses work', async () => {
  const graph = structuredClone(classifierAgent);
  graph.nodes.find((node) => node.id === 'llm').config.structuredSchema = JSON.stringify({ category: 'string', confidence: 'number' });
  graph.nodes.find((node) => node.id === 'llm').config.mockResponse = JSON.stringify({ category: 'math', confidence: 0.9 });
  graph.nodes.find((node) => node.id === 'llm').config.outputVariable = 'classification';
  graph.nodes.splice(3, 0, {
    id: 'predicate',
    type: 'predicate',
    label: 'extract_category',
    config: { predicate: 'extract_category', args: ['$classification', '$category'], outputVariables: ['category'] }
  });
  graph.connections = [
    { id: 'c1', from: 'start', to: 'input', kind: 'control' },
    { id: 'c2', from: 'input', to: 'llm', kind: 'control' },
    { id: 'c3', from: 'llm', to: 'predicate', kind: 'control' },
    { id: 'c4', from: 'predicate', to: 'output', kind: 'success' },
    { id: 'c5', from: 'output', to: 'end', kind: 'control' }
  ];
  graph.knowledge.rules = [
    {
      head: { predicate: 'extract_category', args: ['$Classification', '$Category'] },
      body: [
        { predicate: 'identity', args: ['$Classification', '$Category'] }
      ]
    }
  ];
  const result = await runAgent(graph, { question: '2 + 2' });
  assert.equal(result.status, 'completed');
  assert.deepEqual(result.variables.classification, { category: 'math', confidence: 0.9 });
});

test('sub-agent execution and trace are available', async () => {
  const graph = {
    version: 1,
    metadata: { name: 'parent', inputs: ['question'], outputs: ['answer'] },
    nodes: [
      { id: 'start', type: 'start', label: 'Start', config: {} },
      { id: 'input', type: 'input', label: 'Question', config: { variable: 'question' } },
      { id: 'call', type: 'subAgent', label: 'Call classifier', config: { agent: 'classifier_agent', inputMappings: { question: '$question' }, outputMappings: { category: 'answer' } } },
      { id: 'output', type: 'output', label: 'Answer', config: { variable: 'answer' } },
      { id: 'end', type: 'end', label: 'End', config: {} }
    ],
    connections: [
      { id: 'c1', from: 'start', to: 'input', kind: 'control' },
      { id: 'c2', from: 'input', to: 'call', kind: 'control' },
      { id: 'c3', from: 'call', to: 'output', kind: 'control' },
      { id: 'c4', from: 'output', to: 'end', kind: 'control' }
    ],
    knowledge: { facts: [], rules: [] },
    subAgents: { classifier_agent: classifierAgent }
  };
  const result = await runAgent(graph, { question: '2 + 2' });
  assert.equal(result.output.answer, 'math');
  assert.ok(result.trace.length >= 4);
});

test('validation finds missing producers and broken decisions', () => {
  const graph = createEmptyGraph('broken');
  const decision = { id: 'decision', type: 'decision', label: 'Broken', config: { left: '$missing', operator: '==', right: 'x' } };
  graph.nodes.push(decision);
  graph.connections.push({ id: 'cx', from: graph.nodes[2].id, to: decision.id, kind: 'control' });
  const errors = validateGraph(graph);
  assert.ok(errors.some((error) => error.reason.includes('Variable missing')));
  assert.ok(errors.some((error) => error.reason.includes('true and false')));
});
