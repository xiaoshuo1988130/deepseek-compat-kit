# Real Endpoint Validation

This guide describes a repeatable way to validate DeepSeek-compatible endpoints before adopting them in an Agent workflow.

It is meant for real endpoints such as the official DeepSeek API, relay providers, a local CompatKit proxy, or a private OpenAI-compatible gateway. It is not a benchmark and does not measure model quality.

## What This Produces

- One JSON probe report per endpoint.
- One Markdown probe report per endpoint.
- A combined provider matrix that can be shared in issues, pull requests, or architecture notes.

Keep JSON reports as the source of truth. Markdown reports are for humans.

## Prepare

Create a report directory:

```bash
mkdir -p ./reports
```

Set only the keys you need:

```bash
export DEEPSEEK_API_KEY="sk-..."
export OPENROUTER_API_KEY="sk-or-..."
export OPENROUTER_APP_URL="https://example.com"
export OPENROUTER_APP_TITLE="DeepSeek CompatKit Probe"
```

Secrets are never written to probe JSON or Markdown reports. Header values supplied through `--header-env` are also omitted from reports.

## Official DeepSeek

```bash
npx deepseek-compat-kit probe \
  --endpoint https://api.deepseek.com \
  --name "Official DeepSeek" \
  --model deepseek-chat \
  --profile official \
  --api-key-env DEEPSEEK_API_KEY \
  --checks all \
  --timeout-ms 15000 \
  --out ./reports/official-deepseek.json \
  --markdown ./reports/Official_DeepSeek.md
```

Use this run as the control case. If a relay or private gateway fails a check that official DeepSeek passes, the issue is likely in the relay, gateway, model mapping, or deployment runtime.

## OpenRouter

```bash
npx deepseek-compat-kit probe \
  --endpoint https://openrouter.ai/api/v1 \
  --name "OpenRouter DeepSeek" \
  --model deepseek/deepseek-chat \
  --profile relay \
  --api-key-env OPENROUTER_API_KEY \
  --header-env "HTTP-Referer=OPENROUTER_APP_URL" \
  --header-env "X-Title=OPENROUTER_APP_TITLE" \
  --checks all \
  --timeout-ms 15000 \
  --out ./reports/openrouter-deepseek.json \
  --markdown ./reports/OpenRouter_DeepSeek.md
```

Use `--header-env` when a provider expects attribution or routing headers that should not be written into reports. Probe records the header names and environment variable names, not the values.

## Local Compat Proxy

Start the proxy in one terminal:

```bash
npx deepseek-compat-kit proxy \
  --port 8787 \
  --upstream https://api.deepseek.com \
  --upstream-api-key-env DEEPSEEK_API_KEY
```

Probe it from another terminal:

```bash
npx deepseek-compat-kit probe \
  --endpoint http://127.0.0.1:8787 \
  --name "Local Compat Proxy" \
  --model deepseek-chat \
  --profile self-hosted \
  --checks all \
  --timeout-ms 15000 \
  --out ./reports/local-compat-proxy.json \
  --markdown ./reports/Local_Compat_Proxy.md
```

This validates the proxy path, not just the upstream provider.

## Private or Self-Hosted Gateway

```bash
npx deepseek-compat-kit probe \
  --endpoint http://127.0.0.1:8000/v1 \
  --name "Private vLLM Gateway" \
  --model deepseek-chat \
  --profile self-hosted \
  --checks all \
  --timeout-ms 15000 \
  --out ./reports/private-vllm.json \
  --markdown ./reports/Private_vLLM.md
```

For private gateways, keep the endpoint name descriptive enough to identify the deployment, but avoid embedding internal hostnames in public issue reports.

## Build a Matrix

```bash
npx deepseek-compat-kit matrix ./reports \
  --out ./provider-matrix.json \
  --markdown ./Provider_Matrix.md
```

Use an adoption gate when a specific workflow must work:

```bash
npx deepseek-compat-kit matrix ./reports \
  --require agent \
  --fail-on-fail \
  --out ./provider-matrix.json \
  --markdown ./Provider_Matrix.md
```

Use warning and regression gates in CI when you already have a known-good baseline:

```bash
npx deepseek-compat-kit matrix ./reports \
  --fail-on-warn \
  --fail-on-regression
```

## What to Share in an Issue

Share:

- The Markdown report for the failing endpoint.
- The combined provider matrix.
- The command shape, with secrets removed.
- The target framework or gateway name and version.

Do not share:

- API keys.
- Raw prompts containing private code or customer data.
- Full relay URLs containing token query parameters.

## Interpreting Results

`PASS` means the endpoint passed a small functional check.

`WARN` means the endpoint responded, but a behavior is risky for Agent adoption. Examples include missing tool calls, non-event-stream streaming responses, or partial strict-schema behavior.

`FAIL` means the endpoint failed a required request path or returned an incompatible response.

For Agent adoption, the most important checks are:

- `multi_turn_tool_messages`
- `strict_schema`

For SDK plumbing, the most important checks are:

- `chat_completions`
- `streaming`

## Boundaries

This workflow does not prove that every Agent framework is compatible. It proves that an endpoint passed a compact, repeatable set of DeepSeek-oriented functional checks.

Use the result as an adoption screen, regression guard, and issue attachment, not as a model quality ranking.
