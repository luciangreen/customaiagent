const NODE_SHAPES = {
  start: 'circle',
  end: 'circle',
  input: 'parallelogram',
  output: 'parallelogram',
  predicate: 'rounded-rectangle',
  decision: 'diamond',
  llm: 'hexagon',
  memory: 'cylinder',
  subAgent: 'double-rectangle',
  tool: 'trapezoid',
  loop: 'stacked'
};

const NODE_ICONS = {
  start: '◉',
  end: '◎',
  input: '⇢',
  output: '⇠',
  predicate: 'λ',
  decision: '?',
  llm: '✦',
  memory: '⛁',
  subAgent: '▣',
  tool: '🛠',
  loop: '⟳'
};

export const NODE_DEFINITIONS = [
  { type: 'start', label: 'Start' },
  { type: 'end', label: 'End' },
  { type: 'input', label: 'Input' },
  { type: 'output', label: 'Output' },
  { type: 'predicate', label: 'Predicate' },
  { type: 'decision', label: 'Decision' },
  { type: 'llm', label: 'LLM' },
  { type: 'memory', label: 'Memory' },
  { type: 'subAgent', label: 'Sub-Agent' },
  { type: 'tool', label: 'Tool' },
  { type: 'loop', label: 'Loop' }
];

const DEFAULT_CONFIG = {
  start: {},
  end: {},
  input: { variable: 'question', source: 'input' },
  output: { variable: 'answer' },
  predicate: {
    predicate: 'known_answer',
    args: ['$question', '$answer'],
    outputVariables: ['answer'],
    determinism: 'semidet'
  },
  decision: { left: '$value', operator: '==', right: 'expected' },
  llm: {
    model: 'mock-default',
    systemPrompt: 'Answer the user.',
    promptTemplate: '{{question}}',
    inputVariables: ['question'],
    outputVariable: 'answer',
    structuredSchema: '',
    retryCount: 1,
    errorBehaviour: 'failure',
    mockResponse: ''
  },
  memory: {
    scope: 'session',
    operation: 'read',
    key: 'history',
    value: '$history',
    outputVariable: 'history'
  },
  subAgent: {
    agent: 'classifier_agent',
    inputMappings: { question: '$question' },
    outputMappings: { answer: 'answer' }
  },
  tool: {
    tool: 'calculator',
    requestTemplate: '{{question}}',
    outputVariable: 'answer'
  },
  loop: {
    sourceVariable: 'items',
    itemVariable: 'item',
    targetVariable: 'results',
    operation: 'identity',
    predicate: 'identity',
    args: ['$item', '$resultItem'],
    outputVariable: 'resultItem'
  }
};

let idCounter = 0;

export function createNode(type, position = {}) {
  idCounter += 1;
  const label = NODE_DEFINITIONS.find((item) => item.type === type)?.label ?? type;
  return {
    id: `node_${idCounter}`,
    type,
    label,
    x: position.x ?? 80,
    y: position.y ?? 80,
    width: 140,
    height: 90,
    shape: NODE_SHAPES[type] ?? 'rectangle',
    icon: NODE_ICONS[type] ?? '□',
    config: structuredClone(DEFAULT_CONFIG[type] ?? {})
  };
}

export function createEmptyGraph(name = 'school_agent') {
  const start = createNode('start', { x: 90, y: 80 });
  const input = createNode('input', { x: 90, y: 220 });
  const predicate = createNode('predicate', { x: 90, y: 360 });
  const output = createNode('output', { x: 360, y: 360 });
  const end = createNode('end', { x: 360, y: 500 });
  output.config.variable = 'answer';
  return {
    version: 1,
    metadata: {
      name,
      inputs: ['question'],
      outputs: ['answer'],
      llmProfile: 'mock-default'
    },
    nodes: [start, input, predicate, output, end],
    connections: [
      createConnection(start.id, input.id, 'control'),
      createConnection(input.id, predicate.id, 'control'),
      createConnection(predicate.id, output.id, 'success'),
      createConnection(output.id, end.id, 'control')
    ],
    knowledge: {
      facts: [
        { predicate: 'known_answer', args: ['What is 5 + 6?', '11'] }
      ],
      rules: []
    },
    subAgents: {}
  };
}

export function createConnection(from, to, kind = 'control') {
  idCounter += 1;
  return {
    id: `edge_${idCounter}`,
    from,
    to,
    kind
  };
}

export function duplicateNode(node, offset = 24) {
  const copy = structuredClone(node);
  idCounter += 1;
  copy.id = `node_${idCounter}`;
  copy.x += offset;
  copy.y += offset;
  copy.label = `${copy.label} copy`;
  return copy;
}

export function normalizeGraph(graph) {
  return structuredClone(graph);
}
