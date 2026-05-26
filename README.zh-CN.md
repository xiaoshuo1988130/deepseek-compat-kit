# DeepSeek CompatKit

[![CI](https://github.com/xiaoshuo1988130/deepseek-compat-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/xiaoshuo1988130/deepseek-compat-kit/actions/workflows/ci.yml)

[English](README.md)

面向 DeepSeek V4 工具调用 Agent 的兼容性与诊断工具。

用一个本地 OpenAI-compatible proxy 修复和诊断 DeepSeek V4 tool-calling 迁移问题。启动 proxy，把客户端 `baseURL` 指过去，先尽量不改现有 Agent loop。

> 迁移窗口：DeepSeek 官方说明 `deepseek-chat` 和 `deepseek-reasoner` 将在 **2026-07-24** 停用。如果你的 Agent 依赖多轮 tool calling，建议现在就验证 V4 路径。
>
> 来源：[DeepSeek API Docs Change Log](https://api-docs.deepseek.com/updates/)

优先解决这个常见错误：

```text
The reasoning_content in the thinking mode must be passed back to the API
```

如果你的 OpenAI-compatible Agent 在迁移 V4 时出现多轮工具调用错误，DeepSeek CompatKit 可以帮助定位问题，并提供临时兼容缓解方案。

## Quickstart

1. 先运行一个不需要 DeepSeek API key 的本地验证：

```bash
git clone https://github.com/xiaoshuo1988130/deepseek-compat-kit.git
cd deepseek-compat-kit
npm run demo:mock
```

2. 启动本地兼容 proxy：

```bash
DEEPSEEK_API_KEY=sk-... npx deepseek-compat-kit proxy --port 8787
```

3. 把现有 OpenAI-compatible client 的 `baseURL` 指向：

```text
http://127.0.0.1:8787/v1
```

```js
const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: "http://127.0.0.1:8787/v1",
});
```

终端里应该能看到类似输出：

```text
[deepseek-compat-kit] proxy alpha listening on http://127.0.0.1:8787/v1
WARN DSK_REASONING_003 messages[1]: injected cached reasoning_content for 1 tool call(s).
[openai-js-tool-calls] final: mock upstream received repaired reasoning_content
[openai-js-tool-calls] proxy injected reasoning_content: true
```

## 命令

把 Zod/Pydantic 等生成的 JSON Schema 编译为 DeepSeek strict mode 兼容 schema：

```bash
npx deepseek-compat-kit compile-schema -i ./tools.schema.json --dry-run
npx deepseek-compat-kit compile-schema -i ./tools.schema.json -o ./deepseek.tools.schema.json --report ./deepseek.schema.report.json
```

建议先用 `--dry-run` 预览计划改动，不写入文件。报告会包含被移除的约束、`system_prompt_appendix` 和需要回到应用层执行的 `post_validation_plan`。

探测官方、中转商或自托管 OpenAI-compatible endpoint 的 Agent 能力：

```bash
npx deepseek-compat-kit probe --endpoint https://api.deepseek.com --model deepseek-chat --profile official --out ./deepseek-capability-report.json --markdown ./Capability_Report.md
```

`probe` 是小请求量的功能兼容性检查，不是压测或模型质量评测。使用 `--profile official`、`--profile relay` 或 `--profile self-hosted` 可以在 JSON 和 Markdown 报告里得到更贴近端点类型的建议。

打印一个只读、不改配置的 OpenCode 接入处方：

```bash
npx deepseek-compat-kit inventory --path . --out ./deepseek-inventory.json --markdown ./DeepSeek_Inventory.md
npx deepseek-compat-kit doctor --target auto --path . --markdown ./DeepSeek_Doctor.md
npx deepseek-compat-kit doctor --target opencode --path . --markdown ./DeepSeek_Doctor.md
npx deepseek-compat-kit doctor --target cline --path . --markdown ./DeepSeek_Doctor.md
npx deepseek-compat-kit doctor --target roo-code --path . --markdown ./DeepSeek_Doctor.md
npx deepseek-compat-kit doctor --target openai-js --path . --markdown ./DeepSeek_Doctor.md
npx deepseek-compat-kit doctor --target langchain-js --path . --markdown ./DeepSeek_Doctor.md
npx deepseek-compat-kit recipes opencode
npx deepseek-compat-kit recipes cline
npx deepseek-compat-kit recipes roo-code
npx deepseek-compat-kit recipes openai-js
npx deepseek-compat-kit recipes langchain-js
```

inventory 和 doctor 路径刻意保持保守：只扫描显式指定的本地路径，脱敏 secret 值，识别可能的接入目标，输出配置建议，不修改本地工具文件。使用 `doctor --target auto --path .` 可以基于检测到的目标生成一份合并的只读接入报告。

proxy 默认转发到 `https://api.deepseek.com`。如果要测试或接自托管网关：

```bash
npx deepseek-compat-kit proxy --port 8787 --upstream http://127.0.0.1:9000
```

诊断一次保存的运行日志：

```bash
npx deepseek-compat-kit diagnose ./logs/deepseek-run.jsonl
```

检查 DeepSeek strict mode 工具 schema：

```bash
npx deepseek-compat-kit lint-schema ./tools.schema.json --strict --base-url https://api.deepseek.com/beta
```

生成脱敏 replay fixture：

```bash
npx deepseek-compat-kit sanitize ./logs/deepseek-run.jsonl --out ./safe-replay.jsonl
```

再次运行无 key 验证：

```bash
npm run demo:mock
```

## 第一阶段解决什么

- DeepSeek V4 多轮 tool calling 中的 `reasoning_content` 回传问题。
- 将 Zod/Pydantic/JSON Schema 生成物编译为 DeepSeek strict mode 兼容 schema。
- 接入官方、中转商或自托管 endpoint 前，生成小型 Agent 能力报告。
- Strict mode schema 兼容问题，例如不支持字段、缺失 `required`、缺失 `additionalProperties: false`、base URL 不正确。
- 可安全提交到 GitHub issue 的脱敏 replay fixture。
- 在上游框架合入正式修复之前，用最小 local proxy 临时止血。

## Proxy 能力边界

本地 proxy 是 **stateful best-effort** 缓解方案，不是 stateless magic fix。

只有当相关请求和响应从对话开始就经过 proxy，proxy 才可能保存并回放 `reasoning_content`。如果框架传给 proxy 的 `messages` 已经丢失了 `reasoning_content`，DeepSeek CompatKit 只能诊断缺失，不能凭空还原。

简单说：要从第一轮对话开始就让流量经过 proxy。

初始 proxy 范围：

- 单进程内存态。
- 官方 DeepSeek OpenAI-compatible `/chat/completions`。
- non-streaming `reasoning_content` 捕获与补回。
- 基础 streaming 透传，并尽力捕获供后续轮次使用。
- 请求时 schema warning，同时输出到终端与响应头。
- 默认脱敏本地诊断日志。

## 文档

- [Getting started](docs/getting-started.md)
- [reasoning_content 400 错误说明](docs/errors/reasoning-content-400.zh-CN.md)
- [Reasoning content 400 error](docs/errors/reasoning-content-400.md)
- [Strict schema unsupported fields](docs/errors/strict-schema-unsupported-fields.md)
- [GitHub issue triage guide](docs/github-issue-triage.md)
- [Terminal diagnostics](docs/terminal-diagnostics.md)
- [Capability probe](docs/capability-probe.md)
- [Adoption doctor and inventory](docs/adoption-doctor.md)
- [OpenCode + DeepSeek recipe](docs/recipes/opencode-deepseek.md)
- [Cline + DeepSeek recipe](docs/recipes/cline-deepseek.md)
- [Roo Code legacy + DeepSeek recipe](docs/recipes/roo-code-deepseek.md)
- [OpenAI JS SDK + DeepSeek recipe](docs/recipes/openai-js-deepseek.md)
- [LangChain JS + DeepSeek recipe](docs/recipes/langchain-js-deepseek.md)
- [v0.1.0 release notes](docs/releases/v0.1.0.md)
- [v0.1.1 release notes](docs/releases/v0.1.1.md)
- [v0.1.2 release notes](docs/releases/v0.1.2.md)

## 示例与集成

### 可运行 Demo

- [OpenAI JS multi-turn tool calling](examples/openai-js-tool-calls)
- [No-key mock upstream demo](examples/mock-upstream)
- [curl proxy smoke test](examples/curl)

### 集成配置指南

- [OpenAI JS SDK baseURL proxy](examples/openai-js)
- [OpenClaw integration guide](examples/openclaw)
- [Hermes Agent integration guide](examples/hermes-agent)

### 兼容性边界说明

- [Claude Code compatibility note](examples/claude-code)

## 状态

项目处于早期 public alpha 阶段。proxy 行为已经通过无 API key 的 mock upstream demo 验证；真实 DeepSeek live regression tests 仍待补充。第一目标是先打穿一个窄而可靠的切口：赢下 `reasoning_content` 400 诊断、strict schema 检查和最小 local proxy，再扩展到 SDK shim、框架示例、Docker、成本与 cache 可观测性。

## License

MIT
