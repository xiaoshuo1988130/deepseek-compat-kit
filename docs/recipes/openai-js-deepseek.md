# OpenAI JS SDK + DeepSeek CompatKit Recipe

This is a print-only recipe for routing an existing OpenAI JS SDK project through the local DeepSeek CompatKit proxy.

Status: configuration recipe only. Live project-specific validation is pending.

## Boundary

- DeepSeek CompatKit does not edit source files.
- Keep API keys in environment variables or your existing secret store.
- This recipe assumes your code can configure `baseURL` explicitly.

## Recipe

Start the local compatibility proxy:

```bash
DEEPSEEK_API_KEY=sk-... npx deepseek-compat-kit proxy --port 8787
```

Configure the OpenAI JS client with the local base URL:

```js
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: process.env.DEEPSEEK_BASE_URL || "http://127.0.0.1:8787/v1",
});
```

Probe the path before using it for a real Agent task:

```bash
npx deepseek-compat-kit probe --endpoint http://127.0.0.1:8787 --model deepseek-chat --out ./deepseek-capability-report.json --markdown ./Capability_Report.md
```

If the project sends generated tool schemas, preview strict-mode changes first:

```bash
npx deepseek-compat-kit compile-schema -i ./tools.schema.json --dry-run
```

## Troubleshooting

If requests fail before reaching DeepSeek, check `DEEPSEEK_BASE_URL` and the proxy health endpoint:

```bash
curl http://127.0.0.1:8787/health
```

If strict schemas fail, run `compile-schema --dry-run` and move removed constraints into application-level validation.

If multi-turn tool calling fails with `reasoning_content` errors, route the whole conversation through the proxy from turn one.

## CLI

Print this recipe from the CLI:

```bash
npx deepseek-compat-kit recipes openai-js
```

Generate a doctor report:

```bash
npx deepseek-compat-kit doctor --target openai-js --path . --markdown ./DeepSeek_Doctor.md
```
