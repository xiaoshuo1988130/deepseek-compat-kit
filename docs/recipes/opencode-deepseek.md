# OpenCode + DeepSeek CompatKit Recipe

This is a print-only recipe for routing an OpenCode OpenAI-compatible provider through the local DeepSeek CompatKit proxy.

Status: configuration recipe only. Live OpenCode end-to-end validation is pending.

## Boundary

- DeepSeek CompatKit does not edit OpenCode configuration files.
- DeepSeek CompatKit does not scan your local OpenCode workspace by default.
- Keep API keys in environment variables or your existing secret store.
- Do not paste API keys, prompts, tool results, or raw `reasoning_content` into public issues.

## Recipe

Start the local compatibility proxy:

```bash
DEEPSEEK_API_KEY=sk-... npx deepseek-compat-kit proxy --port 8787
```

In the OpenCode provider entry that supports an OpenAI-compatible base URL, set the base URL to:

```text
http://127.0.0.1:8787/v1
```

Probe the path before using it for a real task:

```bash
npx deepseek-compat-kit probe --endpoint http://127.0.0.1:8787 --model deepseek-chat --out ./deepseek-capability-report.json --markdown ./Capability_Report.md
```

If a tool schema fails under strict mode, compile and inspect it:

```bash
npx deepseek-compat-kit compile-schema -i ./tools.schema.json -o ./deepseek.tools.schema.json --report ./deepseek.schema.report.json
npx deepseek-compat-kit lint-schema ./deepseek.tools.schema.json --strict --base-url https://api.deepseek.com/beta
```

## Troubleshooting

If OpenCode reports a provider connection error, test the local proxy:

```bash
curl http://127.0.0.1:8787/health
```

If the probe report warns on streaming, use non-streaming mode until the endpoint is verified.

If the proxy reports `DSK_REASONING_002`, route the whole conversation through the proxy from turn one. The proxy cannot reconstruct `reasoning_content` that was lost before DeepSeek CompatKit saw the conversation.

## CLI

Print this recipe from the CLI:

```bash
npx deepseek-compat-kit recipes opencode
```

Print the same recipe through the no-write doctor command:

```bash
npx deepseek-compat-kit doctor --target opencode --print
```
