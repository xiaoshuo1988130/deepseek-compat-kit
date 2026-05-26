# LangChain JS + DeepSeek CompatKit Recipe

This is a print-only recipe for routing a LangChain JS `ChatOpenAI` integration through the local DeepSeek CompatKit proxy.

Status: configuration recipe only. Live LangChain JS end-to-end validation is pending.

## Boundary

- DeepSeek CompatKit does not edit LangChain project files.
- This recipe uses `@langchain/openai` with `configuration.baseURL`.
- LangChain provider packages and agent APIs can change; verify the exact package version in your project.
- Keep API keys in environment variables or your existing secret store.

## Recipe

Start the local compatibility proxy:

```bash
DEEPSEEK_API_KEY=sk-... npx deepseek-compat-kit proxy --port 8787
```

Configure `ChatOpenAI` with the local base URL:

```ts
import { ChatOpenAI } from "@langchain/openai";

const model = new ChatOpenAI({
  model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
  apiKey: process.env.DEEPSEEK_API_KEY,
  configuration: {
    baseURL: process.env.DEEPSEEK_BASE_URL || "http://127.0.0.1:8787/v1",
  },
});
```

Probe the local path before running an Agent:

```bash
npx deepseek-compat-kit probe --endpoint http://127.0.0.1:8787 --model deepseek-chat --out ./deepseek-capability-report.json --markdown ./Capability_Report.md
```

If LangChain tools are generated from Zod or JSON Schema, preview strict-mode changes:

```bash
npx deepseek-compat-kit compile-schema -i ./tools.schema.json --dry-run
```

## Troubleshooting

If LangChain retries or wraps provider errors, inspect the proxy terminal logs and the probe report first.

If tool calling fails after the first turn, verify whether the full conversation was routed through the proxy from turn one.

If schemas fail under strict mode, compile a DeepSeek-compatible copy and keep removed constraints in application validation.

## References

- LangChain JS ChatOpenAI integration: <https://docs.langchain.com/oss/javascript/integrations/chat/openai>
- LangChain JS providers and models: <https://docs.langchain.com/oss/javascript/concepts/providers-and-models>

## CLI

Print this recipe from the CLI:

```bash
npx deepseek-compat-kit recipes langchain-js
```

Generate a doctor report:

```bash
npx deepseek-compat-kit doctor --target langchain-js --path . --markdown ./DeepSeek_Doctor.md
```
