# Example Provider Matrix

This is an illustrative example of a generated provider matrix. It is not a live result and should not be cited as current provider status.

Generate a real matrix from your own probe reports:

```bash
npx deepseek-compat-kit matrix ./reports \
  --out ./provider-matrix.json \
  --markdown ./Provider_Matrix.md
```

## Summary

| Provider | Overall | Basic | Agent | Notes |
| --- | --- | --- | --- | --- |
| Official DeepSeek | PASS | PASS | PASS | Control endpoint for comparison. |
| OpenRouter DeepSeek | WARN | PASS | WARN | Example relay with a strict-schema warning. |
| Local Compat Proxy | PASS | PASS | PASS | Proxy path validated against an upstream endpoint. |
| Private vLLM Gateway | FAIL | WARN | FAIL | Example self-hosted endpoint missing strict tool behavior. |

## Capabilities

| Provider | chat_completions | streaming | multi_turn_tool_messages | strict_schema |
| --- | --- | --- | --- | --- |
| Official DeepSeek | PASS | PASS | PASS | PASS |
| OpenRouter DeepSeek | PASS | PASS | WARN | WARN |
| Local Compat Proxy | PASS | PASS | PASS | PASS |
| Private vLLM Gateway | PASS | WARN | FAIL | FAIL |

## Required Capability Gate

Example command:

```bash
npx deepseek-compat-kit matrix ./reports --require agent --fail-on-fail
```

Example result:

| Provider | Required Capabilities | Gate |
| --- | --- | --- |
| Official DeepSeek | multi_turn_tool_messages, strict_schema | PASS |
| OpenRouter DeepSeek | multi_turn_tool_messages, strict_schema | WARN |
| Local Compat Proxy | multi_turn_tool_messages, strict_schema | PASS |
| Private vLLM Gateway | multi_turn_tool_messages, strict_schema | FAIL |

## Example Recommendations

- Treat `Official DeepSeek` as the control case when comparing relay behavior.
- Investigate relay-specific warnings before using `OpenRouter DeepSeek` in a strict production Agent loop.
- Use `Local Compat Proxy` for migration triage only after validating the whole conversation path through the proxy.
- Do not adopt `Private vLLM Gateway` for multi-turn tool calling until strict schema and reasoning-content behavior are fixed.
