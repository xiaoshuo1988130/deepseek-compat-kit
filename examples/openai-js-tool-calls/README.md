# OpenAI JS Tool-Calling Example

This example uses the official OpenAI JavaScript SDK against DeepSeek CompatKit's local proxy.

It runs without a DeepSeek API key by starting:

- the repository mock DeepSeek-compatible upstream
- the local DeepSeek CompatKit proxy
- an OpenAI SDK client whose only compatibility setting is `baseURL`

The second turn intentionally drops `reasoning_content` from the assistant tool-call message before sending it back through the proxy. The demo passes only if the proxy restores the cached reasoning state before forwarding the request upstream.

## Run

From the repository root:

```bash
npm run demo:openai-js-tool-calls
```

Expected output:

```text
[openai-js-tool-calls] first turn tool call: call_mock_weather
[openai-js-tool-calls] intentionally dropped reasoning_content before turn 2
[openai-js-tool-calls] final: mock upstream received repaired reasoning_content
[openai-js-tool-calls] proxy injected reasoning_content: true
```

## Key line

```js
const client = new OpenAI({
  apiKey: "mock-key",
  baseURL: `http://127.0.0.1:${proxyPort}/v1`,
});
```

For real DeepSeek usage, start the proxy with `DEEPSEEK_API_KEY` and point `baseURL` to `http://127.0.0.1:8787/v1`.

