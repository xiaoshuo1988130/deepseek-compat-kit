# Terminal Diagnostics

The CLI should show clear, copyable diagnostics. It should not rely on flashy output or unverifiable savings claims.

## Example

```text
[deepseek-compat-kit] proxy listening on http://127.0.0.1:8787/v1
[deepseek-compat-kit] upstream: https://api.deepseek.com
[deepseek-compat-kit] reasoning state ttl: 3600000 ms
[deepseek-compat-kit] diagnostics log: ./logs/proxy.jsonl
WARN DSK_REASONING_003 messages[4]: restored cached reasoning_content for 1 tool call(s).
ERROR DSK_SCHEMA_003 tools[0].function.parameters.required: object property "query" must be listed in required.
[deepseek-compat-kit] sanitize: removed authorization header and redacted reasoning_content body
```

## Health

```bash
curl http://127.0.0.1:8787/health
```

The health endpoint reports runtime state such as upstream URL, upstream timeout, configured reasoning state TTL, cache entry count, and extra upstream header names. It reports whether the selected API key environment variable is present, but it does not print API key or custom header values.

## Diagnostics Log

```bash
npx deepseek-compat-kit proxy --diagnostics-log ./logs/proxy.jsonl
npx deepseek-compat-kit diagnose ./logs/proxy.jsonl --out ./diagnose-report.json --markdown ./Diagnose_Report.md
```

The proxy diagnostics log is JSONL. It is intentionally structural: assistant/tool-call IDs, finding codes, response status, and redacted summaries are included, while prompt text, tool result bodies, API keys, custom header values, and full `reasoning_content` are not written.

The optional diagnose JSON report is machine-readable. The Markdown report summarizes event counts, known findings, next steps, and privacy notes for issue triage. `diagnose` includes both findings inferred from request/response history and findings already recorded by the proxy, such as `DSK_REASONING_002` or schema warnings.

Use `--fail-on-warn` when warning-level proxy or schema findings should fail a local script or CI gate.

## Rules

- Use readable text and limited color.
- Keep logs copyable.
- Never print API keys, authorization headers, cookies, or full prompts by default.
- Never claim fake cost savings.
- Use real usage fields before showing cache or cost estimates.
- Say `restored reasoning_content`, not `injected cached tokens`.
