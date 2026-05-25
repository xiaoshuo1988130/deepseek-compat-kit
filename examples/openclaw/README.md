# OpenClaw Integration Guide

This guide shows how to route OpenClaw's DeepSeek-compatible traffic through DeepSeek CompatKit.

Status: **configuration guide only**. This has not yet been validated as a live OpenClaw end-to-end test.

## Why

OpenClaw supports OpenAI-compatible model providers. DeepSeek CompatKit exposes a local OpenAI-compatible `/v1/chat/completions` proxy, so the integration path is to point OpenClaw's provider `baseUrl` at:

```text
http://127.0.0.1:8787/v1
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

## 2. Configure an OpenAI-compatible provider in OpenClaw

Use an OpenAI-compatible provider entry and set its base URL to the local proxy.

The exact config location can vary by OpenClaw version. The important fields are:

```yaml
models:
  providers:
    deepseek-compat:
      type: openai
      baseUrl: http://127.0.0.1:8787/v1
      apiKey: sk-placeholder
```

Use a placeholder API key only if OpenClaw requires one. DeepSeek CompatKit can read the real key from `DEEPSEEK_API_KEY` when the incoming request does not include an `Authorization` header.

If your OpenClaw config already sends a DeepSeek key in the request header, keep that key there and start the proxy without `DEEPSEEK_API_KEY`.

## 3. Select the proxied model

Point the OpenClaw agent/model entry at the provider you configured above.

Example shape:

```yaml
models:
  agents:
    default:
      model: deepseek-compat/<your-deepseek-v4-model>
```

Replace `<your-deepseek-v4-model>` with the model identifier you use for DeepSeek V4.

## 4. Verify

Run an OpenClaw task that performs at least one tool call. Watch the DeepSeek CompatKit terminal:

```text
WARN DSK_REASONING_003 messages[...]: injected cached reasoning_content for 1 tool call(s).
```

If you see that log, OpenClaw sent the conversation through the proxy and DeepSeek CompatKit restored cached `reasoning_content` before forwarding the request upstream.

## Boundary

This is a stateful best-effort mitigation.

DeepSeek CompatKit can help only when the relevant requests and responses pass through the proxy from the beginning of the conversation. It cannot reconstruct `reasoning_content` that OpenClaw or another layer dropped before the proxy saw it.

## Current Validation

- DeepSeek CompatKit proxy behavior: validated against mock upstream.
- OpenAI JS SDK baseURL flow: validated in CI.
- OpenClaw live end-to-end flow: pending.

