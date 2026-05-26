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
WARN DSK_REASONING_003 messages[4]: injected cached reasoning_content for 1 tool call(s).
```

If the proxy never saw the original response that contained `reasoning_content`, it cannot reconstruct it. In that case it can diagnose the missing state, but the framework needs to preserve the field earlier in the conversation.

## 4. Create a safe fixture

If you need to file an issue, sanitize your run first:

```bash
npx deepseek-compat-kit sanitize ./logs/deepseek-run.jsonl --out ./safe-replay.jsonl
```

The sanitizer redacts API keys, bearer tokens, emails, tool results, and `reasoning_content` bodies by default.
