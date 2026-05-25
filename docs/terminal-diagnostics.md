# Terminal Diagnostics

The CLI should show clear, copyable diagnostics. It should not rely on flashy output or unverifiable savings claims.

## Example

```text
[deepseek-compat-kit] proxy alpha listening on http://127.0.0.1:8787/v1
[deepseek-compat-kit] upstream: https://api.deepseek.com
WARN DSK_REASONING_003 messages[4]: injected cached reasoning_content for 1 tool call(s).
ERROR DSK_SCHEMA_003 tools[0].function.parameters.required: object property "query" must be listed in required.
[deepseek-compat-kit] sanitize: removed authorization header and redacted reasoning_content body
```

## Rules

- Use readable text and limited color.
- Keep logs copyable.
- Never print API keys, authorization headers, cookies, or full prompts by default.
- Never claim fake cost savings.
- Use real usage fields before showing cache or cost estimates.
- Say `restored reasoning_content`, not `injected cached tokens`.
