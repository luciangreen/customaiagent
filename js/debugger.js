export function formatTrace(trace = []) {
  if (!trace.length) {
    return 'No trace available.';
  }

  return trace
    .map((entry, index) => {
      const summary = [
        `${index + 1}. ${entry.label} (${entry.type})`,
        entry.branch ? `branch: ${entry.branch}` : null,
        entry.prompt ? `prompt: ${entry.prompt}` : null,
        entry.response !== undefined ? `response: ${JSON.stringify(entry.response)}` : null,
        entry.variables ? `vars: ${JSON.stringify(entry.variables, null, 2)}` : null,
        entry.error ? `error: ${entry.error}` : null
      ].filter(Boolean);
      return summary.join('\n');
    })
    .join('\n\n');
}
