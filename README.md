# DeepSeek CompatKit

[![CI](https://github.com/xiaoshuo1988130/deepseek-compat-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/xiaoshuo1988130/deepseek-compat-kit/actions/workflows/ci.yml)

[中文](README.zh-CN.md)

Compatibility and diagnostics for DeepSeek V4 tool-calling agents.

Fix DeepSeek V4 tool-calling migrations with a local OpenAI-compatible proxy. Start the proxy, change your client `baseURL`, and keep the rest of your agent loop unchanged while you diagnose the failure.

> Migration window: DeepSeek says `deepseek-chat` and `deepseek-reasoner` will be discontinued on **2026-07-24**. If your agent depends on multi-turn tool calling, test the V4 path now.
>
> Source: [DeepSeek API Docs Change Log](https://api-docs.deepseek.com/updates/)

Built first for this error:

```text
The reasoning_content in the thinking mode must be passed back to the API
```

If your OpenAI-compatible agent loop breaks during the V4 migration, DeepSeek CompatKit helps diagnose and temporarily mitigate common tool-calling failures.

## Quickstart

1. Verify the proxy behavior without a DeepSeek API key:

```bash
git clone https://github.com/xiaoshuo1988130/deepseek-compat-kit.git
cd deepseek-compat-kit
npm run demo:mock
```

2. Start the local proxy:

```bash
DEEPSEEK_API_KEY=sk-... npx deepseek-compat-kit proxy --port 8787
```

3. Point your OpenAI-compatible client at:

```text
http://127.0.0.1:8787/v1
```

```js
const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: "http://127.0.0.1:8787/v1",
});
```

What you should see in the terminal:

```text
[deepseek-compat-kit] proxy alpha listening on http://127.0.0.1:8787/v1
WARN DSK_REASONING_003 messages[1]: injected cached reasoning_content for 1 tool call(s).
[openai-js-tool-calls] final: mock upstream received repaired reasoning_content
[openai-js-tool-calls] proxy injected reasoning_content: true
```

## Commands

Compile a Zod/Pydantic/generated JSON Schema into a DeepSeek strict-mode compatible schema:

```bash
npx deepseek-compat-kit compile-schema -i ./tools.schema.json --dry-run
npx deepseek-compat-kit compile-schema -i ./tools.schema.json --check
npx deepseek-compat-kit compile-schema -i ./tools.schema.json -o ./deepseek.tools.schema.json --report ./deepseek.schema.report.json --markdown ./deepseek.schema.report.md
```

Use `--dry-run` first to preview planned changes without writing files. Use `--check` in CI when schema repairs should fail the job. The JSON and Markdown reports include removed constraints, a `system_prompt_appendix`, and a `post_validation_plan` for checks that must move back into application code.

Probe an official, relay, or self-hosted OpenAI-compatible endpoint:

```bash
npx deepseek-compat-kit probe --endpoint https://api.deepseek.com --model deepseek-chat --profile official --api-key-env DEEPSEEK_API_KEY --timeout-ms 15000 --out ./deepseek-capability-report.json --markdown ./Capability_Report.md
```

`probe` is a small functional compatibility check, not a benchmark or load test. Use `--profile official`, `--profile relay`, or `--profile self-hosted` to get endpoint-specific guidance in the JSON and Markdown reports.
If a user accidentally passes a full `/chat/completions` URL, `probe` normalizes it to the base URL and records an endpoint diagnostic in the report.
Use `--api-key-env NAME` when your relay or gateway stores its credential outside `DEEPSEEK_API_KEY`.
Use `--fail-on-warn` in CI when warning-level capability gaps should block adoption.
Use `--checks agent` for a focused, lower-cost CI gate that covers multi-turn tool messages and strict schemas. Use `--checks basic` for chat and streaming only.
Use `--baseline ./previous-report.json --fail-on-regression` to catch endpoint capability regressions after provider or gateway changes.

Summarize multiple probe reports into a provider matrix:

```bash
npx deepseek-compat-kit matrix ./reports/*.json --out ./provider-matrix.json --markdown ./Provider_Matrix.md
npx deepseek-compat-kit matrix ./reports/*.json --fail-on-warn --fail-on-regression
```

Print a no-write OpenCode setup recipe:

```bash
npx deepseek-compat-kit inventory --path . --out ./deepseek-inventory.json --markdown ./DeepSeek_Inventory.md
npx deepseek-compat-kit doctor --target auto --path . --markdown ./DeepSeek_Doctor.md
npx deepseek-compat-kit doctor --target opencode --path . --markdown ./DeepSeek_Doctor.md
npx deepseek-compat-kit doctor --target cline --path . --markdown ./DeepSeek_Doctor.md
npx deepseek-compat-kit doctor --target roo-code --path . --markdown ./DeepSeek_Doctor.md
npx deepseek-compat-kit doctor --target openai-js --path . --markdown ./DeepSeek_Doctor.md
npx deepseek-compat-kit doctor --target langchain-js --path . --markdown ./DeepSeek_Doctor.md
npx deepseek-compat-kit recipes opencode
npx deepseek-compat-kit recipes cline
npx deepseek-compat-kit recipes roo-code
npx deepseek-compat-kit recipes openai-js
npx deepseek-compat-kit recipes langchain-js
```

The inventory and doctor paths are intentionally conservative: they scan only the explicit local path, redact secret values, detect likely adoption targets, print configuration prescriptions, and do not modify local tool files. Use `doctor --target auto --path .` to generate one combined print-only adoption report from detected targets.

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

Run the no-key proof again:

```bash
npm run demo:mock
```

## What It Solves First

- DeepSeek V4 `reasoning_content` round-trip failures in multi-turn tool calling.
- Generated Zod/Pydantic/JSON Schema output that needs to be compiled into DeepSeek strict mode.
- Official, relay, or self-hosted endpoints that need a small Agent capability report before adoption.
- Strict-mode schema incompatibilities such as unsupported fields, missing `required`, missing `additionalProperties: false`, or using the wrong base URL.
- Safe, shareable replay fixtures for GitHub issues.
- A minimal local proxy for temporary migration relief while upstream frameworks land proper fixes.

## Proxy Boundary

The local proxy is a **stateful best-effort** mitigation, not a stateless magic fix.

It can only help replay `reasoning_content` when the relevant requests and responses passed through the proxy from the beginning of the conversation. If a framework sends an already-broken `messages` array where `reasoning_content` was lost before DeepSeek CompatKit saw it, the proxy can diagnose the missing field but cannot reconstruct it from nothing.

In short: route the whole conversation through the proxy from turn one.

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
- [Capability probe](docs/capability-probe.md)
- [Adoption doctor and inventory](docs/adoption-doctor.md)
- [OpenCode + DeepSeek recipe](docs/recipes/opencode-deepseek.md)
- [Cline + DeepSeek recipe](docs/recipes/cline-deepseek.md)
- [Roo Code legacy + DeepSeek recipe](docs/recipes/roo-code-deepseek.md)
- [OpenAI JS SDK + DeepSeek recipe](docs/recipes/openai-js-deepseek.md)
- [LangChain JS + DeepSeek recipe](docs/recipes/langchain-js-deepseek.md)
- [v0.1.0 release notes](docs/releases/v0.1.0.md)
- [v0.1.1 release notes](docs/releases/v0.1.1.md)
- [v0.1.2 release notes](docs/releases/v0.1.2.md)
- [v0.1.3 release notes](docs/releases/v0.1.3.md)

## Examples & Integrations

### Runnable Demos

- [OpenAI JS multi-turn tool calling](examples/openai-js-tool-calls)
- [No-key mock upstream demo](examples/mock-upstream)
- [curl proxy smoke test](examples/curl)

### Integration Guides

- [OpenAI JS SDK baseURL proxy](examples/openai-js)
- [OpenClaw integration guide](examples/openclaw)
- [Hermes Agent integration guide](examples/hermes-agent)

### Compatibility Notes

- [Claude Code compatibility note](examples/claude-code)

## Status

This repository is in early public alpha. The proxy behavior is validated against the no-key mock upstream demo; live DeepSeek regression tests are still pending. The first target is a narrow, reliable cut: win `reasoning_content` 400 diagnostics, strict schema checks, and a minimal local proxy before expanding into SDK shims, framework examples, Docker, and cost/cache observability.

## License

MIT
