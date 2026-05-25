# Claude Code Compatibility Note

Status: **not directly supported yet**.

Claude Code commonly uses Anthropic-compatible configuration such as `ANTHROPIC_BASE_URL` and Anthropic Messages API semantics.

DeepSeek CompatKit currently exposes an OpenAI-compatible proxy:

```text
http://127.0.0.1:8787/v1/chat/completions
```

That means this direct path is not supported:

```text
Claude Code -> DeepSeek CompatKit
```

## Why

DeepSeek CompatKit v0.1.x is focused on OpenAI-compatible DeepSeek traffic:

```text
OpenAI-compatible client -> DeepSeek CompatKit -> DeepSeek API
```

Claude Code expects an Anthropic-compatible endpoint unless another gateway translates the request format.

## Possible Gateway Path

If you already use a Claude-Code-compatible gateway that translates Anthropic Messages API requests into OpenAI-compatible DeepSeek chat completions, the compatible path may look like this:

```text
Claude Code -> Anthropic-compatible gateway -> DeepSeek CompatKit -> DeepSeek API
```

For this to help with `reasoning_content`, the final OpenAI-compatible DeepSeek `/chat/completions` traffic must pass through DeepSeek CompatKit from the beginning of the conversation.

## Current Recommendation

- Do not point `ANTHROPIC_BASE_URL` directly at `http://127.0.0.1:8787/v1`.
- Use DeepSeek CompatKit with OpenAI-compatible clients and gateways first.
- Treat Claude Code support as pending until DeepSeek CompatKit has an Anthropic Messages adapter or a validated gateway recipe.

## Future Work

Potential future support:

- Anthropic Messages API adapter.
- Claude Code gateway recipe.
- Live e2e validation with a real Claude Code-compatible gateway.

