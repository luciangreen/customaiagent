const FIELD_SETS = {
  start: [],
  end: [],
  input: [
    { name: 'variable', label: 'Variable', type: 'text' }
  ],
  output: [
    { name: 'variable', label: 'Variable', type: 'text' }
  ],
  predicate: [
    { name: 'predicate', label: 'Predicate', type: 'text' },
    { name: 'args', label: 'Arguments (JSON array)', type: 'json' },
    { name: 'outputVariables', label: 'Output variables (JSON array)', type: 'json' },
    { name: 'determinism', label: 'Determinism', type: 'text' }
  ],
  decision: [
    { name: 'left', label: 'Left operand', type: 'text' },
    { name: 'operator', label: 'Operator', type: 'select', options: ['==', '!=', '>', '>=', '<', '<='] },
    { name: 'right', label: 'Right operand', type: 'text' }
  ],
  llm: [
    { name: 'model', label: 'Model', type: 'text' },
    { name: 'systemPrompt', label: 'System Prompt', type: 'textarea' },
    { name: 'promptTemplate', label: 'Prompt', type: 'textarea' },
    { name: 'inputVariables', label: 'Inputs (JSON array)', type: 'json' },
    { name: 'outputVariable', label: 'Output', type: 'text' },
    { name: 'structuredSchema', label: 'Structured Format (JSON object)', type: 'textarea' },
    { name: 'retryCount', label: 'Retry', type: 'number' },
    { name: 'errorBehaviour', label: 'Error Behaviour', type: 'text' },
    { name: 'mockResponse', label: 'Mock response', type: 'textarea' }
  ],
  memory: [
    { name: 'scope', label: 'Scope', type: 'select', options: ['temporary', 'session', 'persistent'] },
    { name: 'operation', label: 'Operation', type: 'select', options: ['read', 'write', 'append', 'delete'] },
    { name: 'key', label: 'Key', type: 'text' },
    { name: 'value', label: 'Value', type: 'text' },
    { name: 'outputVariable', label: 'Output variable', type: 'text' }
  ],
  subAgent: [
    { name: 'agent', label: 'Agent', type: 'text' },
    { name: 'inputMappings', label: 'Inputs (JSON object)', type: 'textarea' },
    { name: 'outputMappings', label: 'Outputs (JSON object)', type: 'textarea' }
  ],
  tool: [
    { name: 'tool', label: 'Tool', type: 'text' },
    { name: 'requestTemplate', label: 'Request', type: 'textarea' },
    { name: 'outputVariable', label: 'Output', type: 'text' }
  ],
  loop: [
    { name: 'sourceVariable', label: 'Source variable', type: 'text' },
    { name: 'itemVariable', label: 'Item variable', type: 'text' },
    { name: 'targetVariable', label: 'Target variable', type: 'text' },
    { name: 'operation', label: 'Operation', type: 'select', options: ['identity', 'predicate', 'subAgent'] },
    { name: 'predicate', label: 'Predicate', type: 'text' },
    { name: 'args', label: 'Arguments (JSON array)', type: 'json' },
    { name: 'outputVariable', label: 'Item output variable', type: 'text' }
  ]
};

function createField(definition, value) {
  if (definition.type === 'textarea') {
    const element = document.createElement('textarea');
    element.rows = 4;
    element.value = typeof value === 'string' ? value : value ? JSON.stringify(value, null, 2) : '';
    return element;
  }
  if (definition.type === 'select') {
    const element = document.createElement('select');
    for (const option of definition.options ?? []) {
      const optionElement = document.createElement('option');
      optionElement.value = option;
      optionElement.textContent = option;
      if (option === value) {
        optionElement.selected = true;
      }
      element.appendChild(optionElement);
    }
    return element;
  }
  const element = document.createElement('input');
  element.type = definition.type === 'number' ? 'number' : 'text';
  if (definition.type === 'json') {
    element.value = JSON.stringify(value ?? [], null, 0);
  } else {
    element.value = value ?? '';
  }
  return element;
}

function readFieldValue(definition, element) {
  if (definition.type === 'number') {
    return Number(element.value);
  }
  if (definition.type === 'json') {
    try {
      return element.value ? JSON.parse(element.value) : [];
    } catch (error) {
      throw new Error(`${definition.label} must be valid JSON: ${error.message}`);
    }
  }
  if ((definition.name === 'inputMappings' || definition.name === 'outputMappings') && element.value) {
    try {
      return JSON.parse(element.value);
    } catch (error) {
      throw new Error(`${definition.label} must be valid JSON: ${error.message}`);
    }
  }
  return element.value;
}

export function renderPropertyEditor({ container, graph, selectedNode, onUpdate, onDelete, onDuplicate }) {
  container.replaceChildren();
  if (!selectedNode) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = 'Select a node to edit its properties.';
    container.appendChild(empty);
    return;
  }

  const form = document.createElement('form');
  form.className = 'property-grid';

  const labelField = document.createElement('label');
  labelField.textContent = 'Label';
  const labelInput = document.createElement('input');
  labelInput.value = selectedNode.label;
  labelField.appendChild(labelInput);
  form.appendChild(labelField);

  const definitions = FIELD_SETS[selectedNode.type] ?? [];
  const controls = new Map();
  for (const definition of definitions) {
    const label = document.createElement('label');
    label.textContent = definition.label;
    const control = createField(definition, selectedNode.config?.[definition.name]);
    label.appendChild(control);
    controls.set(definition.name, { definition, control });
    form.appendChild(label);
  }

  const applyButton = document.createElement('button');
  applyButton.type = 'submit';
  applyButton.textContent = 'Apply';
  form.appendChild(applyButton);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    try {
      const nextNode = structuredClone(selectedNode);
      nextNode.label = labelInput.value || nextNode.label;
      for (const { definition, control } of controls.values()) {
        nextNode.config[definition.name] = readFieldValue(definition, control);
      }
      onUpdate(nextNode);
    } catch (error) {
      window.alert(error.message);
    }
  });

  const actions = document.createElement('div');
  actions.className = 'property-actions';
  const duplicateButton = document.createElement('button');
  duplicateButton.type = 'button';
  duplicateButton.textContent = 'Duplicate node';
  duplicateButton.addEventListener('click', () => onDuplicate(selectedNode.id));
  actions.appendChild(duplicateButton);

  const deleteButton = document.createElement('button');
  deleteButton.type = 'button';
  deleteButton.textContent = 'Delete node';
  deleteButton.addEventListener('click', () => onDelete(selectedNode.id));
  actions.appendChild(deleteButton);

  container.appendChild(form);
  container.appendChild(actions);

  const connectionList = document.createElement('div');
  connectionList.className = 'chip-row';
  for (const connection of graph.connections.filter((edge) => edge.from === selectedNode.id || edge.to === selectedNode.id)) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = `${connection.kind}: ${connection.from} → ${connection.to}`;
    connectionList.appendChild(chip);
  }
  if (connectionList.childElementCount) {
    container.appendChild(connectionList);
  }
}
