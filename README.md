# DeepSeek CompatKit

Compatibility and diagnostics for DeepSeek V4 tool-calling agents.

DeepSeek legacy models `deepseek-chat` and `deepseek-reasoner` are scheduled for deprecation on **2026-07-24**. If your OpenAI-compatible agent loop breaks during the V4 migration, DeepSeek CompatKit helps diagnose and temporarily mitigate common tool-calling failures.

Fix and diagnose:

```text
The reasoning_content in the thinking mode must be passed back to the API
```

## Quickstart

Run a local compatibility proxy:

```bash
npx deepseek-compat-kit proxy --port 8787
```

Point your OpenAI-compatible client at:

```text
http://127.0.0.1:8787/v1
```

Diagnose a saved run:

```bash
npx deepseek-compat-kit diagnose ./logs/deepseek-run.jsonl
```

Check a DeepSeek strict-mode tool schema:

```bash
npx deepseek-compat-kit lint-schema ./tools.schema.json
```

Create a sanitized replay fixture:

```bash
npx deepseek-compat-kit sanitize ./logs/deepseek-run.jsonl --out ./safe-replay.jsonl
```

## What It Solves First

- DeepSeek V4 `reasoning_content` round-trip failures in multi-turn tool calling.
- Strict-mode schema incompatibilities such as unsupported fields, missing `required`, missing `additionalProperties: false`, or using the wrong base URL.
- Safe, shareable replay fixtures for GitHub issues.
- A minimal local proxy for temporary migration relief while upstream frameworks land proper fixes.

## Proxy Boundary

The local proxy is a **stateful best-effort** mitigation, not a stateless magic fix.

It can only help replay `reasoning_content` when the relevant requests and responses passed through the proxy from the beginning of the conversation. If a framework sends an already-broken `messages` array where `reasoning_content` was lost before DeepSeek CompatKit saw it, the proxy can diagnose the missing field but cannot reconstruct it from nothing.

Initial proxy scope:

- Single-process in-memory state.
- Official DeepSeek OpenAI-compatible `/chat/completions`.
- Non-streaming and basic streaming.
- Request-time schema warnings.
- Sanitized local diagnostics.

## Docs

- [Reasoning content 400 error](docs/errors/reasoning-content-400.md)
- [Strict schema unsupported fields](docs/errors/strict-schema-unsupported-fields.md)
- [GitHub issue triage guide](docs/github-issue-triage.md)
- [Terminal diagnostics](docs/terminal-diagnostics.md)
- [Project plan](PROJECT_PLAN.md)

## Status

This repository is in early public-alpha preparation. The first target is a narrow, reliable cut: win `reasoning_content` 400 diagnostics and strict schema checks before expanding into SDK shims, framework examples, Docker, and cost/cache observability.

## License

MIT
