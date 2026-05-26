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
- Tool or framework targets such as OpenCode, Cline, OpenAI JS SDK, and LangChain JS.

Secret values are never recorded in the JSON or Markdown report. The report only records variable names, file paths, line numbers, and diagnostic codes.

Inventory also emits conservative recommendations. For example, if it detects `openai` or `@langchain/openai` dependencies, it suggests the matching print-only doctor command:

```bash
npx deepseek-compat-kit doctor --target openai-js --path . --markdown ./DeepSeek_Doctor.md
npx deepseek-compat-kit doctor --target langchain-js --path . --markdown ./DeepSeek_Doctor.md
```

These recommendations do not change files. They are routing hints for the next diagnostic step.

## Doctor

Generate one combined print-only report from detected local targets:

```bash
npx deepseek-compat-kit doctor --target auto --path . --markdown ./DeepSeek_Doctor.md
```

`auto` requires an explicit `--path`. It uses inventory heuristics to select matching recipes and still does not modify files.

Print a target-specific recipe:

```bash
npx deepseek-compat-kit doctor --target opencode --print
npx deepseek-compat-kit doctor --target cline --print
npx deepseek-compat-kit doctor --target roo-code --print
npx deepseek-compat-kit doctor --target openai-js --print
npx deepseek-compat-kit doctor --target langchain-js --print
```

Include local inventory hints in a single doctor report:

```bash
npx deepseek-compat-kit doctor --target auto --path . --markdown ./DeepSeek_Doctor.md
npx deepseek-compat-kit doctor --target opencode --path . --markdown ./DeepSeek_Doctor.md
npx deepseek-compat-kit doctor --target cline --path . --markdown ./DeepSeek_Doctor.md
npx deepseek-compat-kit doctor --target roo-code --path . --markdown ./DeepSeek_Doctor.md
npx deepseek-compat-kit doctor --target openai-js --path . --markdown ./DeepSeek_Doctor.md
npx deepseek-compat-kit doctor --target langchain-js --path . --markdown ./DeepSeek_Doctor.md
```

Doctor is print-only in the current release. It can include an inventory summary when `--path` is provided, but it does not edit OpenCode, Cline, Roo, or other third-party configuration files.

## Boundary

- No network calls.
- No global system scan.
- No secret value capture.
- No automatic third-party config rewrites.
- No proof that a provider config is valid. Use `probe` for endpoint capability checks.

Use inventory first to understand local hints, then run `probe` against the selected endpoint, then use a recipe for the specific tool.
