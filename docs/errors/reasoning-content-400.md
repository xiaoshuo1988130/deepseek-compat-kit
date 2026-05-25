# DeepSeek V4 Reasoning Content 400 Error

This page explains the DeepSeek V4 error:

```text
The reasoning_content in the thinking mode must be passed back to the API
```

## Why It Happens

In DeepSeek V4 thinking mode, an assistant response that includes tool calls may also include `reasoning_content`. The next request in the same tool-calling loop must preserve the relevant assistant message state. Some OpenAI-compatible agent loops drop provider-specific fields between turns, so the next request reaches DeepSeek without the required reasoning state.

The common failure shape is:

1. User sends a request.
2. DeepSeek returns an assistant message with tool calls and reasoning state.
3. The framework executes the tool.
4. The framework builds the next request but drops `reasoning_content`.
5. DeepSeek returns HTTP 400.

## Minimal Diagnostic

Inspect the assistant tool-call message from the previous turn and the next request sent to DeepSeek.

Check:

- Was `reasoning_content` present in the assistant response?
- Was that field preserved in the next request?
- Did the tool call id remain stable?
- Did the next request include the matching tool result?

## Temporary Local Proxy

Run:

```bash
npx deepseek-compat-kit proxy --port 8787
```

Then point your OpenAI-compatible client at:

```text
http://127.0.0.1:8787/v1
```

## Important Boundary

The proxy is a **stateful best-effort** mitigation, not a stateless magic fix.

It can only help replay reasoning state when the relevant requests and responses passed through the proxy from the beginning of the conversation. If your framework sends a `messages` array where `reasoning_content` has already been lost, DeepSeek CompatKit can diagnose the missing field but cannot reconstruct it from nothing.

## Safe Issue Fixture

Before sharing logs publicly, sanitize them:

```bash
npx deepseek-compat-kit sanitize ./logs/deepseek-run.jsonl --out ./safe-replay.jsonl
```

By default, sanitized fixtures must not include API keys, Bearer tokens, complete tool results, or full `reasoning_content`.

## Upstream Fix

Frameworks should preserve DeepSeek provider-specific assistant fields across tool-call turns. A durable upstream fix is better than relying on a local proxy forever.
