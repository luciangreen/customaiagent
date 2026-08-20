import { createEmptyGraph, createNode, createConnection, duplicateNode, NODE_DEFINITIONS } from './nodes.js';
import { renderCanvas } from './canvas.js';
import { renderPropertyEditor } from './properties.js';
import { validateGraph } from './validation.js';
import { graphToIR } from '../compiler/graph_to_ir.js';
import { compileIRToProlog } from '../compiler/ir_to_prolog.js';
import { compileIRToJavaScript } from '../compiler/ir_to_js.js';
import { formatTrace } from './debugger.js';
import { runAgent } from './runtime.js';

const EXAMPLE_FILES = {
  school_agent: '../examples/school_agent.json',
  classifier_agent: '../examples/classifier_agent.json',
  research_agent: '../examples/research_agent.json'
};

const elements = {
  agentName: document.querySelector('#agent-name'),
  palette: document.querySelector('#palette-items'),
  workspace: document.querySelector('#workspace'),
  svg: document.querySelector('#connections-layer'),
  propertyEditor: document.querySelector('#property-editor'),
  factsEditor: document.querySelector('#facts-editor'),
  rulesEditor: document.querySelector('#rules-editor'),
  validateButton: document.querySelector('#validate-button'),
  runButton: document.querySelector('#run-button'),
  prologButton: document.querySelector('#prolog-button'),
  exportJsonButton: document.querySelector('#export-json-button'),
  exportPrologButton: document.querySelector('#export-prolog-button'),
  exportJsButton: document.querySelector('#export-js-button'),
  importButton: document.querySelector('#import-button'),
  importFile: document.querySelector('#import-file'),
  prologOutput: document.querySelector('#prolog-output'),
  traceOutput: document.querySelector('#trace-output'),
  runInput: document.querySelector('#run-input'),
  connectButton: document.querySelector('#connect-button'),
  connectStatus: document.querySelector('#connect-status'),
  connectionKind: document.querySelector('#connection-kind'),
  exampleSelect: document.querySelector('#example-select'),
  loadExampleButton: document.querySelector('#load-example-button'),
  undoButton: document.querySelector('#undo-button'),
  redoButton: document.querySelector('#redo-button'),
  zoomRange: document.querySelector('#zoom-range')
};

const history = [];
let historyIndex = -1;
let graph = createEmptyGraph();
let selectedNodeId = null;
let runtimeStates = {};
let connectMode = null;

function setGraph(nextGraph, pushHistory = true) {
  graph = structuredClone(nextGraph);
  graph.metadata.name = elements.agentName.value || graph.metadata.name;
  if (pushHistory) {
    history.splice(historyIndex + 1);
    history.push(structuredClone(graph));
    historyIndex = history.length - 1;
  }
  elements.agentName.value = graph.metadata.name;
  elements.factsEditor.value = JSON.stringify(graph.knowledge?.facts ?? [], null, 2);
  elements.rulesEditor.value = JSON.stringify(graph.knowledge?.rules ?? [], null, 2);
  render();
}

function render() {
  renderCanvas({
    workspace: elements.workspace,
    svg: elements.svg,
    graph,
    selectedNodeId,
    runtimeStates,
    onSelect(nodeId) {
      selectedNodeId = nodeId;
      render();
    },
    onMove(nodeId, position) {
      const node = graph.nodes.find((item) => item.id === nodeId);
      if (!node) {
        return;
      }
      node.x = position.x;
      node.y = position.y;
      render();
    },
    onBackgroundClick() {
      selectedNodeId = null;
      render();
    },
    onTargetNode(nodeId) {
      if (!connectMode || connectMode.source === nodeId) {
        return false;
      }
      graph.connections.push(createConnection(connectMode.source, nodeId, connectMode.kind));
      connectMode = null;
      elements.connectStatus.textContent = 'Connection created.';
      setGraph(graph);
      return true;
    }
  });

  renderPropertyEditor({
    container: elements.propertyEditor,
    graph,
    selectedNode: graph.nodes.find((node) => node.id === selectedNodeId) ?? null,
    onUpdate(nextNode) {
      const index = graph.nodes.findIndex((node) => node.id === nextNode.id);
      graph.nodes[index] = nextNode;
      setGraph(graph);
    },
    onDelete(nodeId) {
      graph.nodes = graph.nodes.filter((node) => node.id !== nodeId);
      graph.connections = graph.connections.filter((edge) => edge.from !== nodeId && edge.to !== nodeId);
      selectedNodeId = null;
      setGraph(graph);
    },
    onDuplicate(nodeId) {
      const node = graph.nodes.find((item) => item.id === nodeId);
      if (!node) {
        return;
      }
      graph.nodes.push(duplicateNode(node));
      setGraph(graph);
    }
  });
}

function downloadFile(name, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function parseKnowledgeEditors() {
  graph.knowledge = {
    facts: JSON.parse(elements.factsEditor.value || '[]'),
    rules: JSON.parse(elements.rulesEditor.value || '[]')
  };
}

function getIR() {
  parseKnowledgeEditors();
  graph.metadata.name = elements.agentName.value || graph.metadata.name;
  return graphToIR(graph);
}

async function loadExample(name) {
  const response = await fetch(EXAMPLE_FILES[name]);
  const exampleGraph = await response.json();
  setGraph(exampleGraph);
}

elements.palette.replaceChildren();
for (const definition of NODE_DEFINITIONS) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'palette__item';
  button.draggable = true;
  button.textContent = definition.label;
  button.addEventListener('click', () => {
    graph.nodes.push(createNode(definition.type, { x: 120, y: 120 }));
    setGraph(graph);
  });
  button.addEventListener('dragstart', (event) => {
    event.dataTransfer?.setData('text/plain', definition.type);
  });
  elements.palette.appendChild(button);
}

elements.workspace.addEventListener('dragover', (event) => {
  event.preventDefault();
});

elements.workspace.addEventListener('drop', (event) => {
  event.preventDefault();
  const type = event.dataTransfer?.getData('text/plain');
  if (!type) {
    return;
  }
  const rect = elements.workspace.getBoundingClientRect();
  graph.nodes.push(createNode(type, { x: event.clientX - rect.left, y: event.clientY - rect.top }));
  setGraph(graph);
});

elements.agentName.addEventListener('change', () => {
  graph.metadata.name = elements.agentName.value || graph.metadata.name;
  setGraph(graph);
});

elements.validateButton.addEventListener('click', () => {
  try {
    parseKnowledgeEditors();
    const errors = validateGraph(graph);
    runtimeStates = {};
    elements.traceOutput.textContent = errors.length
      ? errors.map((error) => `• ${error.label}: ${error.reason}`).join('\n')
      : 'Validation succeeded.';
  } catch (error) {
    elements.traceOutput.textContent = `Validation failed: ${error.message}`;
  }
  render();
});

elements.prologButton.addEventListener('click', () => {
  try {
    const ir = getIR();
    elements.prologOutput.value = compileIRToProlog(ir);
  } catch (error) {
    elements.traceOutput.textContent = `Prolog generation failed: ${error.message}`;
  }
});

elements.runButton.addEventListener('click', async () => {
  try {
    const ir = getIR();
    const rawInput = elements.runInput.value.trim();
    const input = rawInput.startsWith('{') || rawInput.startsWith('[') ? JSON.parse(rawInput) : rawInput;
    const result = await runAgent(ir, input, { agentRegistry: ir.subAgents });
    runtimeStates = result.runtimeStates;
    elements.prologOutput.value = compileIRToProlog(ir);
    elements.traceOutput.textContent = `${formatTrace(result.trace)}\n\nOutput: ${JSON.stringify(result.output, null, 2)}`;
    render();
  } catch (error) {
    elements.traceOutput.textContent = `Run failed: ${error.message}`;
  }
});

elements.exportJsonButton.addEventListener('click', () => {
  parseKnowledgeEditors();
  downloadFile(`${graph.metadata.name}.agent.json`, JSON.stringify(graph, null, 2), 'application/json');
});

elements.exportPrologButton.addEventListener('click', () => {
  const ir = getIR();
  downloadFile(`${graph.metadata.name}.pl`, compileIRToProlog(ir), 'text/plain');
});

elements.exportJsButton.addEventListener('click', () => {
  const ir = getIR();
  downloadFile(`${graph.metadata.name}.js`, compileIRToJavaScript(ir), 'text/javascript');
});

elements.importButton.addEventListener('click', () => elements.importFile.click());

elements.importFile.addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }
  const text = await file.text();
  setGraph(JSON.parse(text));
});

elements.connectButton.addEventListener('click', () => {
  if (!selectedNodeId) {
    elements.connectStatus.textContent = 'Select a source node first.';
    return;
  }
  connectMode = {
    source: selectedNodeId,
    kind: elements.connectionKind.value
  };
  elements.connectStatus.textContent = `Click a target node to create a ${connectMode.kind} connection.`;
});

elements.loadExampleButton.addEventListener('click', () => {
  loadExample(elements.exampleSelect.value).catch((error) => {
    elements.traceOutput.textContent = `Example load failed: ${error.message}`;
  });
});

elements.undoButton.addEventListener('click', () => {
  if (historyIndex <= 0) {
    return;
  }
  historyIndex -= 1;
  graph = structuredClone(history[historyIndex]);
  render();
});

elements.redoButton.addEventListener('click', () => {
  if (historyIndex >= history.length - 1) {
    return;
  }
  historyIndex += 1;
  graph = structuredClone(history[historyIndex]);
  render();
});

elements.zoomRange.addEventListener('input', () => {
  elements.workspace.style.transform = `scale(${Number(elements.zoomRange.value) / 100})`;
});

setGraph(graph);
loadExample('school_agent').catch(() => undefined);
