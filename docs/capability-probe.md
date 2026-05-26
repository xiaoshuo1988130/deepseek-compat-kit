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
  --profile official \
  --api-key-env DEEPSEEK_API_KEY \
  --timeout-ms 15000 \
  --out ./deepseek-capability-report.json \
  --markdown ./Capability_Report.md
```

For a third-party relay:

```bash
npx deepseek-compat-kit probe \
  --endpoint https://relay.example.com/v1 \
  --model deepseek-chat \
  --profile relay \
  --out ./deepseek-capability-report.json \
  --markdown ./Capability_Report.md
```

For a local proxy or self-hosted gateway:

```bash
npx deepseek-compat-kit probe \
  --endpoint http://127.0.0.1:8787 \
  --model deepseek-chat \
  --profile self-hosted \
  --out ./deepseek-capability-report.json \
  --markdown ./Capability_Report.md
```

`probe` expects a base URL, but it will normalize a common mistake: if `--endpoint` ends with `/chat/completions`, the report records an endpoint diagnostic and sends requests to the corrected base URL.

Use `--timeout-ms` to cap each probe request. The default is `15000`.

Use `--fail-on-warn` when running in CI and you want warning-level compatibility gaps to return exit code `1`. Without this flag, warnings are reported but the command only fails on failed checks.

Use `--api-key-env NAME` when the endpoint uses a non-DeepSeek environment variable. By default, `probe` uses `DEEPSEEK_API_KEY` when present, then `OPENAI_API_KEY` when present. Reports only record the environment variable name and whether a value was present; API keys are never written to JSON or Markdown reports.

When an endpoint returns an error body, `probe` includes a short sanitized excerpt in the report. Bearer tokens, `sk-...` API keys, email addresses, and common URL token parameters are redacted before writing JSON or Markdown reports.

Use `--checks` to run a subset of checks when you want a cheaper CI gate or a focused triage run:

```bash
npx deepseek-compat-kit probe \
  --endpoint https://relay.example.com/v1 \
  --model deepseek-chat \
  --checks strict_schema,multi_turn_tool_messages \
  --fail-on-warn
```

## Profiles

Use `--profile` to tune report guidance:

| Profile | Use When | Aliases |
| --- | --- | --- |
| `official` | Calling the official DeepSeek API directly. | `deepseek`, `deepseek-official` |
| `openai` | Generic OpenAI-compatible endpoint. | `openai-compatible`, `generic` |
| `relay` | Third-party relay or API gateway. | `gateway`, `provider`, `third-party` |
| `self-hosted` | Local or private OpenAI-compatible server. | `vllm`, `ollama`, `local` |

## Current Checks

| Capability | What It Tests | Why It Matters |
| --- | --- | --- |
| `chat_completions` | Minimal non-streaming `POST /chat/completions` | Verifies the basic OpenAI-compatible request path. |
| `streaming` | `stream: true` with event-stream-like response | Verifies whether streaming clients can parse incremental responses. |
| `multi_turn_tool_messages` | Follow-up request containing assistant `tool_calls`, `reasoning_content`, and a matching `tool` result | Verifies whether Agent loops can pass DeepSeek reasoning content back through multi-turn tool-call history. |
| `strict_schema` | Minimal strict tool schema request with forced tool choice | Verifies whether tool-calling agents can send DeepSeek strict-mode compatible schemas and receive usable `tool_calls`. |

## Reading the Report

The JSON report includes:

- `summary.status`: `PASS`, `WARN`, or `FAIL`.
- `summary.capabilities`: per-capability status.
- `auth.api_key_env` and `auth.api_key_present`: which environment variable was used, without the secret value.
- `checks_requested`: the selected capability checks for this run.
- `timeout_ms` and `fail_on_warn`: execution controls used for this run.
- `endpoint_input` and `endpoint_diagnostics`: original endpoint plus any normalization warnings.
- `profile_guidance`: endpoint-specific hints, risks, and next steps.
- `checks[]`: check-level HTTP status, duration, notes, impact, and recommendation.

The Markdown report includes the same matrix, execution context, and human-readable recommendations.

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

If `multi_turn_tool_messages` warns or fails:

- Confirm that the framework preserves `reasoning_content` from the previous assistant tool-call turn.
- Confirm that the provider accepts assistant messages containing both `tool_calls` and `reasoning_content`.
- Re-run the same probe directly against the official DeepSeek endpoint to separate framework, relay, and self-hosted endpoint behavior.

If `strict_schema` warns or fails:

- Run `compile-schema --dry-run` on generated tool schemas.
- Run `lint-schema --strict --base-url https://api.deepseek.com/beta`.
- Confirm that the relay or self-hosted endpoint supports DeepSeek strict schema behavior and does not silently ignore forced tool calls.

## Boundary

Passing `probe` means the endpoint passed a small set of functional checks. It does not prove that every framework, every streaming edge case, or every multi-turn tool-calling flow will work.
