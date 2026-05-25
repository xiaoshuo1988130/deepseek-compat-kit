# Hermes Agent Integration Guide

This guide shows how to route Hermes Agent DeepSeek traffic through DeepSeek CompatKit.

Status: **configuration guide only**. This has not yet been validated as a live Hermes Agent end-to-end test.

Hermes Agent supports custom provider base URLs. DeepSeek CompatKit exposes a local OpenAI-compatible proxy, so the integration path is:

```text
Hermes Agent -> http://127.0.0.1:8787/v1 -> DeepSeek CompatKit -> DeepSeek API
```

## 1. Start DeepSeek CompatKit

```bash
DEEPSEEK_API_KEY=sk-... npx deepseek-compat-kit proxy --port 8787
```

Expected terminal output:

```text
[deepseek-compat-kit] proxy alpha listening on http://127.0.0.1:8787/v1
[deepseek-compat-kit] upstream: https://api.deepseek.com
```

## 2. Environment Variable Path

If your Hermes Agent setup reads DeepSeek settings from environment variables, point `DEEPSEEK_BASE_URL` at the local proxy:

```bash
export DEEPSEEK_BASE_URL=http://127.0.0.1:8787/v1
export DEEPSEEK_API_KEY=sk-placeholder
```

Use a placeholder API key only if Hermes requires one. DeepSeek CompatKit can read the real key from `DEEPSEEK_API_KEY` in the proxy process when the incoming request does not include an `Authorization` header.

If Hermes already sends the real DeepSeek key in the request header, keep that key in Hermes and start the proxy without `DEEPSEEK_API_KEY`.

## 3. Config File Path

If your Hermes Agent setup uses a model/provider config file, configure the DeepSeek provider base URL to the local proxy.

Example shape:

```yaml
provider: deepseek
model: <your-deepseek-v4-model>
base_url: http://127.0.0.1:8787/v1
```

Some Hermes configurations may use `baseUrl` instead of `base_url`; use the key your installed Hermes version expects.

## 4. Verify

Run a Hermes task that performs at least one tool call. Watch the DeepSeek CompatKit terminal:

```text
WARN DSK_REASONING_003 messages[...]: injected cached reasoning_content for 1 tool call(s).
```

If you see that log, Hermes sent the conversation through the proxy and DeepSeek CompatKit restored cached `reasoning_content` before forwarding the request upstream.

## Boundary

This is a stateful best-effort mitigation.

DeepSeek CompatKit can help only when the relevant requests and responses pass through the proxy from the beginning of the conversation. It cannot reconstruct `reasoning_content` that Hermes Agent or another layer dropped before the proxy saw it.

## Current Validation

- DeepSeek CompatKit proxy behavior: validated against mock upstream.
- OpenAI JS SDK baseURL flow: validated in CI.
- Hermes Agent live end-to-end flow: pending.

