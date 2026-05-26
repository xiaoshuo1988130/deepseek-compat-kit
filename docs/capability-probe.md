# Capability Probe

`probe` runs a small functional compatibility check against an OpenAI-compatible endpoint.

It is designed for:

- Official DeepSeek API migration checks.
- Third-party relay provider triage.
- Self-hosted vLLM/Ollama/OpenAI-compatible gateway smoke tests.
- GitHub issue reports where a maintainer needs a compact capability matrix.

It is not a latency benchmark, throughput benchmark, or model quality evaluation.

## Run

```bash
npx deepseek-compat-kit probe \
  --endpoint https://api.deepseek.com \
  --model deepseek-chat \
  --out ./deepseek-capability-report.json \
  --markdown ./Capability_Report.md
```

For a local proxy or self-hosted gateway:

```bash
npx deepseek-compat-kit probe \
  --endpoint http://127.0.0.1:8787 \
  --model deepseek-chat \
  --out ./deepseek-capability-report.json \
  --markdown ./Capability_Report.md
```

## Current Checks

| Capability | What It Tests | Why It Matters |
| --- | --- | --- |
| `chat_completions` | Minimal non-streaming `POST /chat/completions` | Verifies the basic OpenAI-compatible request path. |
| `streaming` | `stream: true` with event-stream-like response | Verifies whether streaming clients can parse incremental responses. |
| `strict_schema` | Minimal strict tool schema request | Verifies whether tool-calling agents can send DeepSeek strict-mode compatible schemas. |

## Reading the Report

The JSON report includes:

- `summary.status`: `PASS`, `WARN`, or `FAIL`.
- `summary.capabilities`: per-capability status.
- `checks[]`: check-level HTTP status, duration, notes, impact, and recommendation.

The Markdown report includes the same matrix plus human-readable recommendations.

## Common Follow-Ups

If `chat_completions` fails:

- Confirm the endpoint root is correct.
- Confirm whether `/v1` should be part of the base URL.
- Confirm the API key is valid for that provider.
- Confirm the selected model exists.

If `streaming` warns or fails:

- Disable streaming while triaging the provider.
- Check whether a relay buffers responses instead of returning `text/event-stream`.
- Re-run the probe after changing provider settings.

If `strict_schema` warns or fails:

- Run `compile-schema --dry-run` on generated tool schemas.
- Run `lint-schema --strict --base-url https://api.deepseek.com/beta`.
- Confirm that the relay or self-hosted endpoint supports DeepSeek strict schema behavior.

## Boundary

Passing `probe` means the endpoint passed a small set of functional checks. It does not prove that every framework, every streaming edge case, or every multi-turn tool-calling flow will work.
