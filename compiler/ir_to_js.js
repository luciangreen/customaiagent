export function compileIRToJavaScript(ir) {
  const serialized = JSON.stringify(ir, null, 2);
  return [
    "import { runAgent } from './js/runtime.js';",
    '',
    `export const agent = ${serialized};`,
    '',
    'export async function run(input, options = {}) {',
    '  return runAgent(agent, input, options);',
    '}'
  ].join('\n');
}
