# Cline + DeepSeek CompatKit Recipe

This is a print-only recipe for routing Cline's OpenAI-compatible provider path through the local DeepSeek CompatKit proxy.

Status: configuration recipe only. Live Cline end-to-end validation is pending.

References:

- Cline OpenAI Compatible provider docs: <https://docs.cline.bot/provider-config/openai-compatible>
- Cline SDK OpenAI-compatible provider example: <https://docs.cline.bot/sdk/model-providers>

## Boundary

- DeepSeek CompatKit does not edit VS Code, Cline, or extension storage files.
- DeepSeek CompatKit does not scan your local Cline workspace by default.
- Keep API keys in environment variables or your existing secret store.
- Do not paste API keys, prompts, tool results, or raw `reasoning_content` into public issues.

## Recipe

Optionally inventory the current project first:

```bash
npx deepseek-compat-kit inventory --path . --out ./deepseek-inventory.json --markdown ./DeepSeek_Inventory.md
```

Start the local compatibility proxy:

```bash
DEEPSEEK_API_KEY=sk-... npx deepseek-compat-kit proxy --port 8787
```

In Cline, choose the OpenAI-compatible provider path and set:

```text
Base URL: http://127.0.0.1:8787/v1
API Key: use your DeepSeek API key or your existing local secret flow
Model ID: deepseek-chat
```

Probe the path before using it for a real task:

```bash
npx deepseek-compat-kit probe --endpoint http://127.0.0.1:8787 --model deepseek-chat --out ./deepseek-capability-report.json --markdown ./Capability_Report.md
```

If tool schemas fail under strict mode, preview conversion:

```bash
npx deepseek-compat-kit compile-schema -i ./tools.schema.json --dry-run
```

## Troubleshooting

If Cline cannot connect, test the proxy health endpoint:

```bash
curl http://127.0.0.1:8787/health
```

If Cline starts a conversation before the proxy is configured, restart the task so the full conversation passes through the proxy from turn one.

If the provider UI changes, use this recipe as the stable values to set rather than a promise about exact UI layout.

## CLI

Print this recipe from the CLI:

```bash
npx deepseek-compat-kit recipes cline
```

Print the same recipe through the no-write doctor command:

```bash
npx deepseek-compat-kit doctor --target cline --print
```
