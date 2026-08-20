import { renderConnections } from './connections.js';

export function renderCanvas({ workspace, svg, graph, selectedNodeId, runtimeStates, onSelect, onMove, onBackgroundClick, onTargetNode }) {
  const existingLayer = workspace.querySelector('[data-node-layer]');
  if (existingLayer) {
    existingLayer.remove();
  }
  const layer = document.createElement('div');
  layer.dataset.nodeLayer = 'true';
  layer.style.position = 'relative';
  layer.style.width = '2400px';
  layer.style.height = '1600px';
  workspace.appendChild(layer);

  const nodeElements = new Map();
  for (const node of graph.nodes) {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = `workspace-node shape-${node.shape}`;
    element.dataset.nodeId = node.id;
    element.dataset.selected = String(node.id === selectedNodeId);
    element.dataset.runtimeState = runtimeStates?.[node.id] ?? '';
    element.style.left = `${node.x}px`;
    element.style.top = `${node.y}px`;
    element.innerHTML = `<span>${node.icon} ${node.label}</span>`;
    element.addEventListener('click', (event) => {
      event.stopPropagation();
      if (onTargetNode?.(node.id)) {
        return;
      }
      onSelect(node.id);
    });

    let dragging = false;
    let offsetX = 0;
    let offsetY = 0;
    element.addEventListener('pointerdown', (event) => {
      dragging = true;
      offsetX = event.clientX - node.x;
      offsetY = event.clientY - node.y;
      element.setPointerCapture(event.pointerId);
    });
    element.addEventListener('pointermove', (event) => {
      if (!dragging) {
        return;
      }
      onMove(node.id, {
        x: Math.max(20, event.clientX - offsetX + workspace.scrollLeft - workspace.getBoundingClientRect().left),
        y: Math.max(20, event.clientY - offsetY + workspace.scrollTop - workspace.getBoundingClientRect().top)
      });
    });
    element.addEventListener('pointerup', () => {
      dragging = false;
    });
    layer.appendChild(element);
    nodeElements.set(node.id, element);
  }

  renderConnections(svg, graph, nodeElements);
  workspace.onclick = (event) => {
    if (event.target === workspace || event.target === layer || event.target === svg) {
      onBackgroundClick();
    }
  };
}
