# Mock Upstream Demo

This demo proves the proxy behavior without a DeepSeek API key.

It starts:

- a local mock DeepSeek-compatible upstream
- the DeepSeek CompatKit proxy
- a two-turn request sequence where the second assistant tool-call message intentionally omits `reasoning_content`

The smoke test passes only if the proxy injects cached `reasoning_content` before forwarding the second request upstream.

## Run

From the repository root:

```bash
npm run demo:mock
```

Expected output:

```text
[mock-demo] first turn ok
[mock-demo] second turn ok
[mock-demo] proxy injected reasoning_content: true
```

## Manual Mode

Terminal 1:

```bash
node examples/mock-upstream/server.mjs --port 9000
```

Terminal 2:

```bash
npx deepseek-compat-kit proxy --port 8787 --upstream http://127.0.0.1:9000
```

Then point an OpenAI-compatible client at:

```text
http://127.0.0.1:8787/v1
```

