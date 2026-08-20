# customaiagent

Browser-based MVP for building custom AI agents as visual graphs and compiling them into a shared intermediate representation, readable Prolog, and browser-executable JavaScript.

## Included MVP capabilities

- visual HTML/CSS/JavaScript canvas with geometric node shapes
- drag/drop node creation plus direct add, move, duplicate, delete, undo and redo
- typed control connections for control, success, failure, true, false and loop edges
- configurable Start, End, Input, Output, Predicate, Decision, LLM, Memory, Sub-Agent, Tool and Loop nodes
- canonical graph JSON plus import/export
- graph validation for missing Start, unreachable nodes, undefined variables, invalid decisions, malformed schemas and recursive sub-agent cycles
- graph → IR, IR → Prolog and IR → JavaScript compilation
- browser runtime with trace output, mocked LLM execution, calculator tool, memory scopes, loop mapping and sub-agent calls
- starter examples for school, classifier and research agents
- automated Node.js tests for graph, compiler, runtime, trace, memory, loops, tool calls, structured LLM responses and sub-agents

## Run locally

Open `index.html` in a browser from the repository root, or serve the repository root with any static file server.

To run the automated tests:

```bash
npm test
```

## Supported graph knowledge format

Facts use JSON objects:

```json
{ "predicate": "known_answer", "args": ["What is 2 + 2?", "4"] }
```

Rules use JSON objects:

```json
{
  "head": { "predicate": "local_answer", "args": ["$Question", "$Answer"] },
  "body": [
    { "predicate": "known_answer", "args": ["$Question", "$Answer"] }
  ]
}
```

Variables are referenced with a leading `$` in node configuration, rule heads and rule bodies.

## Notes

- The shared IR is the authoritative machine representation for validation, runtime execution and code generation.
- The generated Prolog is readable and aligned with the graph structure; SWI-Prolog execution is scaffolded through the included runtime files.
- Real LLM access is supported through the `runAgent(..., { llmAdapter })` runtime hook so exported agents never store secrets.
