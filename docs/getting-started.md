# Getting Started

DeepSeek CompatKit is useful when an OpenAI-compatible agent framework loses DeepSeek provider-specific fields during multi-turn tool calling.

The first target is this error:

```text
The reasoning_content in the thinking mode must be passed back to the API
```

## 1. Start the local proxy

To verify the behavior without a DeepSeek API key first:

```bash
git clone https://github.com/xiaoshuo1988130/deepseek-compat-kit.git
cd deepseek-compat-kit
npm run demo:mock
```

You can also run a small functional endpoint probe against a mock or self-hosted endpoint:

```bash
npx deepseek-compat-kit probe --endpoint http://127.0.0.1:9000 --model mock-model --out ./capability-report.json --markdown ./Capability_Report.md
```

`probe` checks basic chat completions, streaming response shape, multi-turn tool-call message history with `reasoning_content`, and a minimal strict tool schema request. It is not a benchmark or load test. The Markdown report is designed for team handoff or upstream issue triage.

Then use the real proxy against DeepSeek:

```bash
DEEPSEEK_API_KEY=sk-... npx deepseek-compat-kit proxy --port 8787
```

The proxy listens at:

```text
http://127.0.0.1:8787/v1
```

By default it forwards to:

```text
https://api.deepseek.com
```

For local tests or self-hosted gateways:

```bash
npx deepseek-compat-kit proxy --port 8787 --upstream http://127.0.0.1:9000
```

For relays or private gateways that require extra upstream headers:

```bash
npx deepseek-compat-kit proxy \
  --port 8787 \
  --upstream https://relay.example.com/v1 \
  --upstream-timeout-ms 30000 \
  --diagnostics-log ./logs/proxy.jsonl \
  --upstream-header "HTTP-Referer: https://example.com" \
  --upstream-header-env "X-Relay-Token=RELAY_TOKEN"
```

Use `--upstream-header` only for non-secret values. Put sensitive custom header values in environment variables and pass them with `--upstream-header-env`.

Use `--upstream-timeout-ms` to cap how long the proxy waits for upstream response headers. After response headers arrive, streaming bodies are allowed to continue.

Use `--state-ttl-ms` to limit how long cached `reasoning_content` can be used for conservative restoration. The default is one hour.

Check runtime state without exposing secrets:

```bash
curl http://127.0.0.1:8787/health
```

The health response includes upstream URL, configured timeout, configured reasoning state TTL, cache entry count, extra upstream header names, and whether the selected API key environment variable is present. It does not include API key or header values.

If you need a portable local trace for debugging, add:

```bash
--diagnostics-log ./logs/proxy.jsonl
```

The diagnostics log records structural request/response events that `diagnose` can read later. It omits prompt text, tool result bodies, API keys, custom header values, and full `reasoning_content`.

`diagnose` combines findings inferred from message history with findings the proxy already recorded during the request, so the report can explain both what broke and why the proxy refused to restore state.

Use `--fail-on-warn` when warning-level proxy or schema findings should fail a local script or CI gate.

## 2. Change only baseURL

Point your OpenAI-compatible client to the local proxy:

```js
const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: "http://127.0.0.1:8787/v1",
});
```

Keep your model, messages, tools, and agent framework unchanged at first.

## 3. Watch the terminal

When the proxy can help, it logs copyable diagnostics such as:

```text
WARN DSK_REASONING_003 messages[4]: restored cached reasoning_content for 1 tool call(s).
```

If the proxy never saw the original response that contained `reasoning_content`, it cannot reconstruct it. In that case it can diagnose the missing state, but the framework needs to preserve the field earlier in the conversation.

## 4. Create a safe fixture

If you need to file an issue, sanitize your run first:

```bash
npx deepseek-compat-kit diagnose ./logs/proxy.jsonl --out ./diagnose-report.json --markdown ./Diagnose_Report.md
npx deepseek-compat-kit sanitize ./logs/deepseek-run.jsonl --out ./safe-replay.jsonl
```

The sanitizer redacts API keys, bearer tokens, emails, tool results, and `reasoning_content` bodies by default.
