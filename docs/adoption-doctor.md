# Adoption Doctor and Inventory

DeepSeek CompatKit includes conservative adoption helpers for local projects that use DeepSeek directly or through an OpenAI-compatible proxy.

## Inventory

Run inventory against an explicit local path:

```bash
npx deepseek-compat-kit inventory --path . --out ./deepseek-inventory.json --markdown ./DeepSeek_Inventory.md
```

Inventory scans only the path you provide. It skips common generated or dependency directories such as `.git`, `node_modules`, `dist`, `build`, `coverage`, `.next`, and `.cache`.

It looks for:

- DeepSeek references.
- DeepSeek model names such as `deepseek-chat`.
- DeepSeek or local proxy base URL candidates.
- API key variable assignments and raw key-like strings.

Secret values are never recorded in the JSON or Markdown report. The report only records variable names, file paths, line numbers, and diagnostic codes.

## Doctor

Print a target-specific recipe:

```bash
npx deepseek-compat-kit doctor --target opencode --print
```

Doctor is print-only in the current release. It does not edit OpenCode, Cline, Roo, or other third-party configuration files.

## Boundary

- No network calls.
- No global system scan.
- No secret value capture.
- No automatic third-party config rewrites.
- No proof that a provider config is valid. Use `probe` for endpoint capability checks.

Use inventory first to understand local hints, then run `probe` against the selected endpoint, then use a recipe for the specific tool.
