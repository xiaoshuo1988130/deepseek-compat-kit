# Provider Matrix

Early status for DeepSeek CompatKit.

Live DeepSeek regression tests are pending. Current proxy behavior is validated against the repository mock upstream and local unit tests.

| Target | Mode | Status | Notes |
| --- | --- | --- | --- |
| Official DeepSeek API | OpenAI-compatible `/chat/completions` | ALPHA | non-streaming tested through local mock upstream |
| Official DeepSeek API | local proxy | ALPHA | single-process memory, stateful best-effort |
| OpenAI JS SDK | baseURL proxy | UNKNOWN | v0.2 target |
| OpenAI Python SDK | baseURL proxy | UNKNOWN | v0.2 target |
| LangChain JS | tool calling | UNKNOWN | v0.2+ |
| LlamaIndex | tool calling | UNKNOWN | v0.2+ |
| OpenCode | tool calling | UNKNOWN | v0.2+ |
| vLLM | OpenAI-compatible runtime | UNKNOWN | v0.2+ |
| OpenRouter | provider runtime | UNKNOWN | v0.2+ |

## Known Alpha Risks

- Proxy state is single-process memory and currently keyed by `tool_call_id`.
- Long-running multi-client proxy usage needs explicit conversation/session isolation before it should be treated as production infrastructure.
- Live DeepSeek API compatibility tests should be added before marking provider support as PASS.
