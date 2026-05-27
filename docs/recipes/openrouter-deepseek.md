# OpenRouter + DeepSeek CompatKit Recipe

This is a print-only recipe for probing a DeepSeek route through OpenRouter, optionally with the local DeepSeek CompatKit proxy in the middle.

Status: configuration recipe only. Live OpenRouter end-to-end validation is pending.

## Boundary

- DeepSeek CompatKit does not edit SDK, framework, or provider configuration files.
- OpenRouter is treated as a relay provider; different model routes can behave differently.
- Keep API keys in environment variables or your existing secret store.
- Do not paste API keys, prompts, tool results, or raw `reasoning_content` into public issues.

## Recipe

Set environment variables:

```bash
export OPENROUTER_API_KEY=sk-or-...
export OPENROUTER_APP_URL=https://example.com
export OPENROUTER_APP_TITLE="DeepSeek CompatKit Probe"
```

Probe OpenRouter directly:

```bash
npx deepseek-compat-kit probe \
  --endpoint https://openrouter.ai/api/v1 \
  --name "OpenRouter DeepSeek" \
  --model deepseek/deepseek-chat \
  --profile relay \
  --api-key-env OPENROUTER_API_KEY \
  --header-env "HTTP-Referer=OPENROUTER_APP_URL" \
  --header-env "X-Title=OPENROUTER_APP_TITLE" \
  --out ./reports/openrouter-deepseek.json \
  --markdown ./reports/OpenRouter_DeepSeek.md
```

If you need the local proxy in the middle:

```bash
OPENROUTER_API_KEY=sk-or-... npx deepseek-compat-kit proxy \
  --port 8787 \
  --upstream https://openrouter.ai/api/v1 \
  --upstream-api-key-env OPENROUTER_API_KEY \
  --upstream-header-env "HTTP-Referer=OPENROUTER_APP_URL" \
  --upstream-header-env "X-Title=OPENROUTER_APP_TITLE"
```

Point your OpenAI-compatible client at:

```text
http://127.0.0.1:8787/v1
```

Compare OpenRouter with other endpoint reports:

```bash
npx deepseek-compat-kit matrix ./reports --require agent --markdown ./Provider_Matrix.md
```

## Troubleshooting

If `chat_completions` fails, confirm the model route and whether your OpenRouter account can access it.

If `strict_schema` warns, compare the same request against the official DeepSeek endpoint before changing application code.

If streaming warns, try a non-streaming Agent run first and keep the JSON probe report for provider triage.

## CLI

Print this recipe from the CLI:

```bash
npx deepseek-compat-kit recipes openrouter
```

Print the same recipe through the no-write doctor command:

```bash
npx deepseek-compat-kit doctor --target openrouter --print
```
