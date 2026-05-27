# GitHub Issue Triage Guide

Use this project in external GitHub issues only when it genuinely helps diagnose a DeepSeek V4 migration failure.

## Good Fit

Reply when an issue includes:

- `reasoning_content`
- `The reasoning_content in the thinking mode must be passed back to the API`
- DeepSeek V4 + tool calling + second-turn or third-turn HTTP 400
- strict schema failures involving `required`, `additionalProperties`, `minLength`, `maxItems`, or beta base URL confusion

## Avoid

Do not reply when:

- The issue is about model quality, latency, pricing, or unrelated provider behavior.
- There is already a clear upstream fix and no workaround is needed.
- You would be posting the same message across unrelated issues.

## Suggested Reply

```text
I think this may be the DeepSeek V4 reasoning_content round-trip issue.

Root cause: in thinking mode, if the assistant produces tool calls, the next request needs to preserve the assistant message reasoning state. Some OpenAI-compatible agent loops drop provider-specific fields between turns, so DeepSeek returns:

"The reasoning_content in the thinking mode must be passed back to the API"

Minimal check:
1. Inspect the assistant tool-call message from the previous turn.
2. Confirm whether reasoning_content is preserved in the next request.
3. If it is missing, the framework needs to round-trip that field.

Temporary local workaround while the upstream fix lands:

npx deepseek-compat-kit proxy --port 8787

Then point the OpenAI-compatible baseURL to:

http://127.0.0.1:8787/v1

Optional report:

npx deepseek-compat-kit diagnose ./logs/proxy.jsonl --out ./diagnose-report.json --markdown ./Diagnose_Report.md

Boundary: this proxy is stateful conservative. It can help only if the relevant requests and responses pass through it. It cannot reconstruct reasoning_content that was already lost before reaching the proxy.

Docs:
https://github.com/<owner>/deepseek-compat-kit/blob/main/docs/errors/reasoning-content-400.md
```

## Tone

Explain first, link second. Do not attack upstream maintainers. Prefer fixtures and pull requests over promotion.
