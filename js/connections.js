export function getNodeById(graph, nodeId) {
  return graph.nodes.find((node) => node.id === nodeId) ?? null;
}

export function getConnectionsFrom(graph, nodeId, kind) {
  return graph.connections.filter((connection) => connection.from === nodeId && (!kind || connection.kind === kind));
}

export function getConnectionsTo(graph, nodeId) {
  return graph.connections.filter((connection) => connection.to === nodeId);
}

export function getControlTargets(graph, nodeId) {
  return graph.connections.filter((connection) => connection.from === nodeId).map((connection) => connection.to);
}

export function getReachableNodeIds(graph) {
  const startNode = graph.nodes.find((node) => node.type === 'start');
  if (!startNode) {
    return new Set();
  }
  const queue = [startNode.id];
  const visited = new Set(queue);
  while (queue.length) {
    const current = queue.shift();
    for (const next of getControlTargets(graph, current)) {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }
  return visited;
}

export function renderConnections(svg, graph, nodeElements) {
  svg.replaceChildren();
  for (const connection of graph.connections) {
    const source = nodeElements.get(connection.from);
    const target = nodeElements.get(connection.to);
    if (!source || !target) {
      continue;
    }
    const sourceRect = source.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const svgRect = svg.getBoundingClientRect();
    const x1 = sourceRect.left + sourceRect.width / 2 - svgRect.left + svg.scrollLeft;
    const y1 = sourceRect.top + sourceRect.height / 2 - svgRect.top + svg.scrollTop;
    const x2 = targetRect.left + targetRect.width / 2 - svgRect.left + svg.scrollLeft;
    const y2 = targetRect.top + targetRect.height / 2 - svgRect.top + svg.scrollTop;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const midX = (x1 + x2) / 2;
    path.setAttribute('class', 'connection-line');
    path.setAttribute('d', `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`);
    svg.appendChild(path);

    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('class', 'connection-label');
    label.setAttribute('x', String(midX));
    label.setAttribute('y', String((y1 + y2) / 2 - 6));
    label.textContent = connection.kind;
    svg.appendChild(label);
  }
}
