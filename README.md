# DeepSeek CompatKit

[中文](README.zh-CN.md)

Compatibility and diagnostics for DeepSeek V4 tool-calling agents.

DeepSeek legacy models `deepseek-chat` and `deepseek-reasoner` are scheduled for deprecation on **2026-07-24**. If your OpenAI-compatible agent loop breaks during the V4 migration, DeepSeek CompatKit helps diagnose and temporarily mitigate common tool-calling failures.

Fix and diagnose:

```text
The reasoning_content in the thinking mode must be passed back to the API
```

## Current Alpha Commands

Run a local compatibility proxy:

```bash
DEEPSEEK_API_KEY=sk-... npx deepseek-compat-kit proxy --port 8787
```

Point your OpenAI-compatible client at:

```text
http://127.0.0.1:8787/v1
```

The proxy forwards to `https://api.deepseek.com` by default. For tests or self-hosted gateways:

```bash
npx deepseek-compat-kit proxy --port 8787 --upstream http://127.0.0.1:9000
```

Diagnose a saved run:

```bash
npx deepseek-compat-kit diagnose ./logs/deepseek-run.jsonl
```

Check a DeepSeek strict-mode tool schema:

```bash
npx deepseek-compat-kit lint-schema ./tools.schema.json --strict --base-url https://api.deepseek.com/beta
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
- Non-streaming `reasoning_content` capture and injection.
- Basic streaming pass-through with best-effort capture for later turns.
- Request-time schema warnings in terminal output and response headers.
- Sanitized local diagnostics.

## Docs

- [Getting started](docs/getting-started.md)
- [Reasoning content 400 error](docs/errors/reasoning-content-400.md)
- [Reasoning content 400 error 中文说明](docs/errors/reasoning-content-400.zh-CN.md)
- [Strict schema unsupported fields](docs/errors/strict-schema-unsupported-fields.md)
- [GitHub issue triage guide](docs/github-issue-triage.md)
- [Terminal diagnostics](docs/terminal-diagnostics.md)
- [v0.1.0 release notes](docs/releases/v0.1.0.md)

## Examples

- [OpenAI JS SDK baseURL proxy](examples/openai-js)
- [curl proxy smoke test](examples/curl)

## Status

This repository is in early public alpha. The first target is a narrow, reliable cut: win `reasoning_content` 400 diagnostics, strict schema checks, and a minimal local proxy before expanding into SDK shims, framework examples, Docker, and cost/cache observability.

## License

MIT
