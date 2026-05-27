# Provider Matrix

Current compatibility status for DeepSeek CompatKit.

Core behavior is validated against repository mock upstreams and local unit tests. Live endpoint validation should be tracked with real `probe` reports and generated matrices.

For a repeatable real-endpoint workflow, see [Real Endpoint Validation](real-endpoint-validation.md). For a non-live example of the generated Markdown shape, see [Example Provider Matrix](examples/provider-matrix.example.md).

Use `matrix` to turn real `probe` JSON reports into a shareable provider matrix:

```bash
npx deepseek-compat-kit matrix ./reports/*.json --out ./provider-matrix.json --markdown ./Provider_Matrix.md
npx deepseek-compat-kit matrix ./reports --out ./provider-matrix.json --markdown ./Provider_Matrix.md
npx deepseek-compat-kit matrix ./reports/*.json --require agent
npx deepseek-compat-kit matrix ./reports/*.json --fail-on-warn --fail-on-regression
```

The generated matrix is only as strong as the probe reports supplied to it. Keep the original JSON reports as the source of truth for issue triage and regression review. Directory inputs are expanded to sorted `*.json` files, excluding the current `--out` file when it lives in the same directory. Use `--require agent`, `--require basic`, or a comma-separated capability list when specific capabilities must pass on every supplied report. Use `--fail-on-fail`, `--fail-on-warn`, or `--fail-on-regression` when the matrix should act as a CI gate.

| Target | Mode | Status | Notes |
| --- | --- | --- | --- |
| Official DeepSeek API | OpenAI-compatible `/chat/completions` | ALPHA | non-streaming tested through local mock upstream |
| Official DeepSeek API | capability probe | ALPHA | functional report shape implemented; live DeepSeek run pending |
| Official DeepSeek API | local proxy | ALPHA | single-process memory, conservative same-turn reasoning restoration |
| Cline | OpenAI-compatible provider recipe | DOCS_ONLY | print-only recipe added; live e2e pending |
| Roo Code | legacy OpenAI-compatible provider recipe | DOCS_ONLY | official docs show sunset notice; installed-copy recipe only |
| OpenAI JS SDK | baseURL proxy recipe | DOCS_ONLY | example and print-only recipe added; live e2e pending |
| OpenAI Python SDK | baseURL proxy | UNKNOWN | v0.2 target |
| LangChain JS | ChatOpenAI baseURL recipe | DOCS_ONLY | print-only recipe added; live e2e pending |
| LlamaIndex | tool calling | UNKNOWN | v0.2+ |
| OpenClaw | OpenAI-compatible provider config | DOCS_ONLY | integration guide added; live e2e pending |
| Hermes Agent | DeepSeek/OpenAI-compatible base URL config | DOCS_ONLY | integration guide added; live e2e pending |
| Claude Code | Anthropic-compatible config | NOT_SUPPORTED | direct support needs Anthropic Messages adapter or validated gateway recipe |
| OpenCode | OpenAI-compatible provider recipe | DOCS_ONLY | print-only recipe added; live e2e pending |
| vLLM | OpenAI-compatible runtime | UNKNOWN | v0.2+ |
| OpenRouter | relay provider recipe | DOCS_ONLY | print-only recipe added; live e2e pending |

## Known Risks

- Proxy state is single-process memory and currently keyed by `tool_call_id`, with same-assistant-turn checks and a configurable TTL before restoration.
- Long-running multi-client proxy usage still needs explicit conversation/session isolation before it should be treated as production infrastructure.
- Use `proxy --diagnostics-log ./logs/proxy.jsonl` when you need a portable, sanitized local trace for `diagnose` or issue triage.
- Probe is a functional compatibility check, not a throughput benchmark, latency benchmark, or model quality evaluation.
- Live endpoint probe reports should be attached before marking provider support as PASS.
