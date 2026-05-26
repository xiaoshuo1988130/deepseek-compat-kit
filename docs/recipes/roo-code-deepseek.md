# Roo Code + DeepSeek CompatKit Recipe

This is a print-only legacy recipe for local Roo Code installations that still expose an OpenAI-compatible provider path.

Status: configuration recipe only. Live Roo Code end-to-end validation is pending.

References:

- Roo Code official docs and sunset notice: <https://docs.roocode.com/>
- Coder AI Bridge Roo Code client configuration: <https://coder.com/docs/ai-coder/ai-bridge/clients/roo-code>

## Boundary

- DeepSeek CompatKit does not edit VS Code, Roo Code, or extension storage files.
- Roo Code official docs currently show a product sunset notice, so this is not a primary adoption target.
- Use this only for installed local copies or compatibility triage.
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

In Roo Code settings, choose an OpenAI-compatible provider path and set:

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

If Roo Code reports a provider error, test the proxy health endpoint and then run `probe`.

If requests never reach the proxy, confirm the selected provider path really uses the custom base URL.

If `reasoning_content` repair is needed, start the Roo Code task only after the proxy is configured.

## CLI

Print this recipe from the CLI:

```bash
npx deepseek-compat-kit recipes roo-code
```

Print the same recipe through the no-write doctor command:

```bash
npx deepseek-compat-kit doctor --target roo-code --print
```
