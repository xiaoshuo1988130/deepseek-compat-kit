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
[deepseek-compat-kit] proxy listening on http://127.0.0.1:8787/v1
WARN DSK_REASONING_003 messages[1]: restored cached reasoning_content for 1 tool call(s).
[openai-js-tool-calls] final: mock upstream received repaired reasoning_content
[openai-js-tool-calls] proxy injected reasoning_content: true
```

## 命令

把 Zod/Pydantic 等生成的 JSON Schema 编译为 DeepSeek strict mode 兼容 schema：

```bash
npx deepseek-compat-kit compile-schema -i ./tools.schema.json --dry-run
npx deepseek-compat-kit compile-schema -i ./tools.schema.json --check
npx deepseek-compat-kit compile-schema -i ./tools.schema.json -o ./deepseek.tools.schema.json --report ./deepseek.schema.report.json --markdown ./deepseek.schema.report.md
```

建议先用 `--dry-run` 预览计划改动，不写入文件。如果要在 CI 里把 schema 修复需求当成阻断项，可以用 `--check`。JSON 和 Markdown 报告会包含被移除的约束、`system_prompt_appendix` 和需要回到应用层执行的 `post_validation_plan`。
报告输出路径会自动创建父目录，所以全新 checkout 下也可以直接写 `./reports/Capability_Report.md` 这类路径。

探测官方、中转商或自托管 OpenAI-compatible endpoint 的 Agent 能力：

```bash
npx deepseek-compat-kit probe --endpoint https://api.deepseek.com --name "Official DeepSeek" --model deepseek-chat --profile official --api-key-env DEEPSEEK_API_KEY --timeout-ms 15000 --out ./deepseek-capability-report.json --markdown ./Capability_Report.md
npx deepseek-compat-kit probe --endpoint https://relay.example.com/v1 --name "Example Relay" --model deepseek-chat --profile relay --header "HTTP-Referer: https://example.com" --header "X-Title: DeepSeek CompatKit Probe" --header-env "X-Relay-Token=RELAY_TOKEN" --out ./relay-capability-report.json --markdown ./Relay_Capability_Report.md
```

`probe` 是小请求量的功能兼容性检查，不是压测或模型质量评测。使用 `--profile official`、`--profile relay` 或 `--profile self-hosted` 可以在 JSON 和 Markdown 报告里得到更贴近端点类型的建议。
如果误把完整 `/chat/completions` URL 传给 `--endpoint`，`probe` 会自动规整为 base URL，并在报告里记录 endpoint diagnostic。
如果中转商或网关的密钥不放在 `DEEPSEEK_API_KEY`，可以用 `--api-key-env NAME` 指定环境变量名。
如果中转商需要非密钥类路由/归因 header，可以重复使用 `--header "Name: Value"`；如果需要敏感自定义 header，用 `--header-env "Name=ENV_VAR"` 从环境变量读取。报告只记录 header 名称和环境变量名，不记录值。
如果要在 CI 里把 warning 级别的能力缺口也当成阻断项，可以加 `--fail-on-warn`。
如果只想做更低成本的 CI 门禁，可以用 `--checks agent` 聚焦多轮工具消息和 strict schema；如果只想检查基础连通和流式响应，可以用 `--checks basic`。
如果要防止 provider 或网关升级后能力退化，可以用 `--baseline ./previous-report.json --fail-on-regression` 做回归门禁。

把多份 probe 报告汇总成 provider matrix：

```bash
npx deepseek-compat-kit matrix ./reports/*.json --out ./provider-matrix.json --markdown ./Provider_Matrix.md
npx deepseek-compat-kit matrix ./reports --out ./provider-matrix.json --markdown ./Provider_Matrix.md
npx deepseek-compat-kit matrix ./reports/*.json --require agent
npx deepseek-compat-kit matrix ./reports/*.json --fail-on-warn --fail-on-regression
```

打印一个只读、不改配置的 OpenCode 接入处方：

```bash
npx deepseek-compat-kit inventory --path . --max-files 500 --out ./deepseek-inventory.json --markdown ./DeepSeek_Inventory.md
npx deepseek-compat-kit doctor --target auto --path . --markdown ./DeepSeek_Doctor.md
npx deepseek-compat-kit doctor --target opencode --path . --markdown ./DeepSeek_Doctor.md
npx deepseek-compat-kit doctor --target cline --path . --markdown ./DeepSeek_Doctor.md
npx deepseek-compat-kit doctor --target roo-code --path . --markdown ./DeepSeek_Doctor.md
npx deepseek-compat-kit doctor --target openrouter --path . --markdown ./DeepSeek_Doctor.md
npx deepseek-compat-kit doctor --target openai-js --path . --markdown ./DeepSeek_Doctor.md
npx deepseek-compat-kit doctor --target langchain-js --path . --markdown ./DeepSeek_Doctor.md
npx deepseek-compat-kit recipes opencode
npx deepseek-compat-kit recipes cline
npx deepseek-compat-kit recipes roo-code
npx deepseek-compat-kit recipes openrouter
npx deepseek-compat-kit recipes openai-js
npx deepseek-compat-kit recipes langchain-js
```

inventory 和 doctor 路径刻意保持保守：只扫描显式指定的本地路径，脱敏 secret 值，识别可能的接入目标，输出配置建议，不修改本地工具文件。Inventory 默认最多扫描 500 个候选文件；如果你明确想扩大或缩小扫描范围，可以使用 `--max-files`。使用 `doctor --target auto --path .` 可以基于检测到的目标生成一份合并的只读接入报告。

proxy 默认转发到 `https://api.deepseek.com`。如果要测试或接自托管网关：

```bash
npx deepseek-compat-kit proxy --port 8787 --upstream http://127.0.0.1:9000
npx deepseek-compat-kit proxy --port 8787 --upstream https://relay.example.com/v1 --upstream-timeout-ms 30000 --state-ttl-ms 3600000 --diagnostics-log ./logs/proxy.jsonl --upstream-header "HTTP-Referer: https://example.com" --upstream-header-env "X-Relay-Token=RELAY_TOKEN"
```

`--upstream-header` 适合非密钥类 relay header，`--upstream-header-env` 适合敏感自定义上游 header。
`--upstream-timeout-ms` 用于限制等待上游响应头的时间，避免本地 Agent 被无响应网关一直卡住。
`--state-ttl-ms` 用于限制缓存的 `reasoning_content` 可被保守补回的时间。默认一小时。
使用 `curl http://127.0.0.1:8787/health` 可以查看 proxy 运行状态，不会暴露 API key 或 header 值。
使用 `--diagnostics-log ./logs/proxy.jsonl` 可以写入已脱敏的结构化 request/response 事件，后续可直接交给 `diagnose` 或用于 issue triage。日志不会写入 prompt 正文、工具结果、API key 或 reasoning 原文。

诊断一次保存的运行日志：

```bash
npx deepseek-compat-kit diagnose ./logs/deepseek-run.jsonl --out ./diagnose-report.json --markdown ./Diagnose_Report.md
```

如果希望 proxy 或 schema 的 warning 级别发现也阻断本地脚本或 CI 门禁，可以加 `--fail-on-warn`。

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

本地 proxy 是 **stateful conservative** 缓解方案，不是 stateless magic fix。

只有当相关请求和响应从对话开始就经过 proxy，proxy 才可能保存并回放 `reasoning_content`。如果框架传给 proxy 的 `messages` 已经丢失了 `reasoning_content`，DeepSeek CompatKit 只能诊断缺失，不能凭空还原。

proxy 只有在 assistant message 中每个 tool call 都命中缓存，且这些缓存来自同一个 assistant turn 时，才会补回 `reasoning_content`。部分命中或混合多个历史轮次时，只告警并原样转发，避免跨轮次或跨会话串线。

简单说：要从第一轮对话开始就让流量经过 proxy。

初始 proxy 范围：

- 单进程内存态。
- reasoning cache 默认一小时 TTL，可通过 `--state-ttl-ms` 调整。
- 官方 DeepSeek OpenAI-compatible `/chat/completions`。
- non-streaming `reasoning_content` 捕获与保守补回。
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
- [Real endpoint validation](docs/real-endpoint-validation.md)
- [Example provider matrix](docs/examples/provider-matrix.example.md)
- [Adoption doctor and inventory](docs/adoption-doctor.md)
- [OpenCode + DeepSeek recipe](docs/recipes/opencode-deepseek.md)
- [Cline + DeepSeek recipe](docs/recipes/cline-deepseek.md)
- [Roo Code legacy + DeepSeek recipe](docs/recipes/roo-code-deepseek.md)
- [OpenRouter + DeepSeek recipe](docs/recipes/openrouter-deepseek.md)
- [OpenAI JS SDK + DeepSeek recipe](docs/recipes/openai-js-deepseek.md)
- [LangChain JS + DeepSeek recipe](docs/recipes/langchain-js-deepseek.md)
- [v0.1.0 release notes](docs/releases/v0.1.0.md)
- [v0.1.1 release notes](docs/releases/v0.1.1.md)
- [v0.1.2 release notes](docs/releases/v0.1.2.md)
- [v0.1.3 release notes](docs/releases/v0.1.3.md)
- [v0.1.4 release notes](docs/releases/v0.1.4.md)

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

DeepSeek CompatKit 是一个本地兼容性与诊断工具箱。核心路径已经由本地测试和 mock-upstream demo 覆盖：strict schema compile/lint、endpoint probe report、provider matrix、inventory/doctor recipes、保守 proxy restoration、脱敏 diagnostics log 和 diagnose report。真实 endpoint 验证会通过 `probe` report 和 provider matrix 单独记录；recipe 文档不等同于 live framework certification。

## License

MIT
