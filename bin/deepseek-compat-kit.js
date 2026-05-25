#!/usr/bin/env node

const command = process.argv[2];

const help = `DeepSeek CompatKit

Compatibility and diagnostics for DeepSeek V4 tool-calling agents.

Commands planned for v0.1:
  proxy --port 8787
  diagnose <run.jsonl>
  replay <fixture.jsonl>
  lint-schema <schema.json>
  sanitize <run.jsonl> --out <safe.jsonl>

Common error:
  The reasoning_content in the thinking mode must be passed back to the API

Proxy boundary:
  reasoning_content repair is stateful best-effort, not a stateless magic fix.
  If reasoning_content was lost before the request reached this proxy, the
  proxy can diagnose the problem but cannot reconstruct the missing content.
`;

if (!command || command === "--help" || command === "-h" || command === "help") {
  console.log(help);
  process.exit(0);
}

console.error(`Command "${command}" is not implemented in this pre-alpha skeleton.`);
console.error("Run `deepseek-compat-kit --help` for the planned v0.1 command surface.");
process.exit(2);
