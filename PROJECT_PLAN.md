# DeepSeek CompatKit 项目计划

## 1. 项目一句话

DeepSeek CompatKit 是一个面向开发者和 Agent 框架维护者的开源兼容层、调试器和回归测试套件，专门解决 DeepSeek V4 及后续模型在 tool calling、thinking mode、多轮工具调用、OpenAI/Anthropic 兼容接口、vLLM/OpenRouter 等运行环境中的接入稳定性问题。

项目目标不是再做一个 Agent 框架，而是做 DeepSeek 生态里的“兼容性基础设施”：让任何已有 Agent 框架更容易、稳定、低成本地接入 DeepSeek。

## 2. 背景与市场判断

### 2.1 DeepSeek 的机会窗口

截至 2026-05-25，DeepSeek 已经从单点模型热点变成持续迭代的模型平台。官方在 2026-04-24 发布 DeepSeek-V4，API 暴露 `deepseek-v4-pro` 和 `deepseek-v4-flash`，并宣布旧模型 `deepseek-chat`、`deepseek-reasoner` 将在 2026-07-24 停用。这意味着大量开发者、Agent 框架和企业内部工具需要迁移到 V4，并处理新旧模型行为差异。

DeepSeek API 兼容 OpenAI Chat Completions 风格，同时也支持 Anthropic 兼容接口。这个兼容性降低了接入门槛，但也制造了一个现实问题：接口形状看起来兼容，行为细节并不总是完全等价。尤其在 tool calling、多轮调用、thinking/reasoning 内容、streaming、JSON schema strict mode 等场景中，开发者容易遇到“同一套 Agent 代码换 provider 后局部崩掉”的问题。

### 2.2 市场缺口

当前生态已有很多“接入 DeepSeek 的教程”和“模型调用 SDK”，但缺少一个专门处理 DeepSeek Agent 兼容性的工程工具：

- 缺少统一的 DeepSeek tool calling 行为适配层。
- 缺少 DeepSeek V4 thinking mode 与传统 `assistant/tool` 消息循环之间的安全转换。
- 缺少能在 CI 中跑的 DeepSeek provider 兼容性回归测试。
- 缺少面向 DeepSeek strict mode 的 JSON Schema linter。
- 缺少能复现、裁剪、分享 DeepSeek Agent 调用失败案例的 replay debugger。
- 缺少跨 OpenAI SDK、Anthropic SDK、vLLM、OpenRouter、LangChain、LlamaIndex、OpenCode 等生态的测试基准。

这类项目的商业价值不在于“调用一次 API”，而在于减少 Agent 系统上线时最烦人的不确定性：多轮工具调用是否会失败、schema 是否可用、streaming 是否一致、上下文缓存是否命中、迁移到新模型后是否产生行为回退。

### 2.3 为什么现在适合做

DeepSeek V4 发布后，旧模型停用带来迁移窗口。大量项目会从旧的 `deepseek-chat` / `deepseek-reasoner` 迁到 `deepseek-v4-pro` / `deepseek-v4-flash`。迁移过程中的兼容问题会非常集中。

同时，Agent 应用正在从 demo 进入生产，企业和开源项目更关心稳定性、可观测性和成本控制。DeepSeek 的低价格和长上下文能力会吸引大量 Agent 场景，但越是便宜高性能，越需要可靠的工程配套。

### 2.4 2026 年 5 月的特殊时间窗口

这个项目当前最值得抓住的是两个叠加窗口：

第一是迁移窗口。DeepSeek 官方已经给出旧模型停用日期，`deepseek-chat` 和 `deepseek-reasoner` 会在 2026-07-24 停用。从 2026-05-25 往后看，生产系统只有约两个月时间完成 V4 迁移。这会带来一波集中排查、集中改造、集中搜索解决方案的开发者流量。

第二是 reasoning/tool calling 兼容窗口。DeepSeek V4 的 thinking mode 与 tool calling 混用时，多轮请求需要正确保留和回传 reasoning/thinking 相关状态。很多上游 Agent 框架和独立项目最初只按 OpenAI-style tool message 循环实现，容易在第二轮或第三轮调用时丢失中间状态，最终触发 400 类错误。DeepSeek CompatKit 的早期传播点应该直接对准这个痛点：定位、复现、修复多轮工具调用中的 reasoning state 丢失。

这两个窗口不会永久存在。等主流框架陆续修复 provider 适配后，单纯的“补丁价值”会下降。因此项目需要从第一天就把兼容性工具沉淀成更长期的能力：fixtures、错误码、replay、provider matrix、成本与 cache 可观测性。

## 3. 目标用户

### 3.1 第一优先级用户

Agent 框架维护者和高级应用开发者。他们已经在用 LangChain、LlamaIndex、OpenAI SDK、Anthropic SDK、OpenCode、Roo/Kilo 类工具或自研 Agent runtime，希望把 DeepSeek 作为低成本或主力模型 provider。

他们的核心诉求：

- 快速知道 DeepSeek V4 在自己的 Agent 循环里能不能稳定工作。
- 遇到 400、tool call 参数错误、schema 不兼容时，能快速定位。
- 希望不大改已有代码就能兼容 DeepSeek。
- 希望在 CI 中防止 provider 升级或 prompt 改动引入回归。

### 3.2 第二优先级用户

企业内部 AI 平台团队。他们需要把 DeepSeek 包装成公司内部标准 provider，服务多个业务团队。

他们的核心诉求：

- 统一治理 DeepSeek 的调用参数、模型版本、schema 规则。
- 观察 cache hit、tool call 成功率、重试率、成本。
- 给内部业务方提供稳定的 Agent 接入规范。

### 3.3 第三优先级用户

普通开发者和独立开发者。他们需要一个可复制的模板，快速把 DeepSeek 接到自己的 coding agent、文档 agent、客服 agent 或工作流工具里。

## 4. 项目定位

### 4.1 做什么

DeepSeek CompatKit 长期应该提供六类能力，但首发版本只打穿最窄的可信闭环。

1. Provider transform core：把 DeepSeek-specific 的 message、tool、schema、reasoning state 转换逻辑沉淀成语言无关的核心规则。
2. SDK shim：在现有 SDK 外包一层 DeepSeek 兼容适配，适合愿意显式集成库的开发者。
3. Local proxy：提供轻量本地/自托管 OpenAI-compatible 反向代理，适合只想修改 `baseURL` 的现有项目。
4. Schema linter/repair：检查、降级并解释 DeepSeek tool schema / strict mode 不兼容点。
5. Replay debugger：录制、回放、裁剪 Agent 调用链，生成最小复现。
6. Compatibility test suite：为常见 Agent 框架和 provider 组合提供回归测试。

项目的架构原则是 core-first。SDK shim 和 local proxy 只是两种交付形态，不能各自维护一套兼容逻辑。所有 message normalization、reasoning state tracking、schema compatibility、diagnostics 都应该复用同一套核心规则和 fixtures。

v0.1 首发只承诺四类最小能力：

1. `lint-schema`：诊断 DeepSeek strict mode schema 兼容问题。
2. `diagnose/replay`：定位 reasoning/tool call/message chain 断裂问题。
3. `sanitize`：生成默认脱敏的公开 issue/replay fixture。
4. 最小 local proxy：单进程内存态、官方 DeepSeek `/chat/completions`、基础 streaming、best-effort reasoning state tracking。

SDK shim、完整 Python 客户端、schema repair、LangChain/LlamaIndex examples、vLLM 深度适配、Docker、live compatibility matrix 都放到 v0.2 或之后。首发要先赢下 `reasoning_content` 400 和 strict schema 诊断这两个关键词。

### 4.2 不做什么

项目早期不做完整 Agent 框架，不做 workflow 编排，不做 GUI 低代码平台，不做模型微调，不做通用 prompt marketplace。

原因很简单：这些方向已经很拥挤，而且会让项目失焦。DeepSeek CompatKit 的独特点应该是“DeepSeek 兼容性和可靠性”，而不是“又一个 Agent 框架”。

项目也不应该在早期把自己定义成通用 LLM gateway。Local proxy 是采用加速器，不是主产品边界。它的存在是为了让已有项目通过修改 `baseURL` 快速接入 DeepSeek CompatKit，而不是要替代 LiteLLM、OpenRouter、自研 API 网关或企业模型路由平台。

## 5. MVP 范围

### 5.1 MVP 核心场景

MVP 只打穿一个高频、高痛点场景：

DeepSeek V4 + OpenAI-compatible message loop + 多轮 tool calling + reasoning state 回传，在 TypeScript/Node 中优先稳定诊断和临时缓解，并能在失败时生成可读诊断和可重放 fixture。

MVP 的第一目标不是“覆盖所有语言/框架”，而是让开发者在遇到 V4 迁移报错时，能在 5 分钟内完成三件事：诊断原因、生成最小复现、用最小 local proxy 临时止血。

### 5.2 MVP 功能清单

#### A. CLI：`deepseek-compat-kit`

v0.1 首发命令：

```bash
deepseek-compat-kit lint-schema ./tools.schema.json
deepseek-compat-kit diagnose ./logs/deepseek-run.jsonl
deepseek-compat-kit replay ./fixtures/tool-calls/reasoning-content-lost.jsonl
deepseek-compat-kit sanitize ./logs/deepseek-run.jsonl --out ./safe-replay.jsonl
deepseek-compat-kit proxy --port 8787
```

v0.1 不把 SDK shim 当主交付。首发要先让用户能诊断、复现、临时代理。

#### B. Provider Transform Core

功能：

- 定义 DeepSeek V4 message、tool、schema、reasoning state 的兼容规则。
- 自动处理 thinking/reasoning 内容在多轮 tool call 中的回传要求。
- 规范化 assistant message、tool call、tool result 的结构。
- 对常见错误返回可读诊断，例如缺少 reasoning 内容、tool call 参数无法解析、schema 字段不支持。
- 为 CLI、replay、local proxy 和后续 SDK shim 提供同一套规则。

#### C. Schema linter

第一版检查：

- JSON Schema 字段是否在 DeepSeek strict mode 支持范围内。
- strict mode 是否使用 DeepSeek beta endpoint：`https://api.deepseek.com/beta`。
- object 的所有 `properties` 是否都出现在 `required` 中。
- object 是否设置 `additionalProperties: false`。
- 是否使用了 DeepSeek strict mode 不支持或风险较高的字段，例如 `minLength`、`maxLength`、`minItems`、`maxItems`、`pattern`、`format`、`minimum`、`maximum`、`multipleOf`。
- tool name、description、parameters 是否符合基本限制。
- enum、object、array 的嵌套结构是否容易导致模型输出不稳定。

输出格式：

```text
ERROR DSK_SCHEMA_001: "minLength" is not supported by DeepSeek strict mode.
ERROR DSK_SCHEMA_002: strict mode requires beta base URL: https://api.deepseek.com/beta.
ERROR DSK_SCHEMA_003: all object properties must be listed in required.
ERROR DSK_SCHEMA_004: object schemas must set additionalProperties: false.
FIX   Remove "minLength" and validate it in application code after tool call.
```

#### D. Replay debugger

第一版支持 JSONL 输入：

```json
{"type":"request","model":"deepseek-v4-flash","messages":[...],"tools":[...]}
{"type":"response","message":{...},"usage":{...}}
{"type":"tool_result","tool_call_id":"...","content":"..."}
```

能力：

- 回放多轮调用。
- 标记 assistant/tool 消息链是否断裂。
- 标记 tool call id 是否缺失或不匹配。
- 标记 reasoning/thinking 内容是否在下一轮丢失。
- 生成最小复现文件。
- 生成 `deepseek-error-reproduce.json`，便于提交 issue 或在 CI 中回归。

#### E. Sanitizer

replay fixture 很可能包含 prompt、tool result、URL、账号、token、email、reasoning 内容。sanitize 必须进入 v0.1，而不是后置。

默认策略：

- 默认移除 API key、Bearer token、cookie、authorization header。
- 默认遮盖 email、手机号、URL query secret、常见 access token。
- 默认不把完整 `reasoning_content` 写入公开 fixture，只保留长度、hash、是否存在、turn id 和必要的结构信息。
- 默认对 tool result 做截断和 hash；用户必须显式 `--include-tool-results` 才能保留。
- 公开 issue fixture 使用 allowlist，而不是 denylist。

#### F. Local proxy alpha

Local proxy 是 v0.1 的最小止血能力，但边界必须写硬。

示例：

```bash
deepseek-compat-kit proxy --port 8787
```

开发者可以把现有 OpenAI-compatible client 的 `baseURL` 指向：

```text
http://127.0.0.1:8787/v1
```

v0.1 只承诺：

- 单进程内存态。
- 官方 DeepSeek OpenAI-compatible `/chat/completions`。
- non-streaming 和基础 streaming。
- 在之前的请求和响应都经过 proxy 时，对 reasoning state 做 best-effort tracking。
- schema lint 的 request-time warning。
- 默认脱敏日志。

v0.1 不承诺：

- 无状态恢复丢失的 `reasoning_content`。
- 凭空还原用户已经丢失的历史 assistant 字段。
- 跨进程、跨机器、长期会话存储。
- 企业级多租户鉴权。
- 高可用网关。
- 复杂 provider routing。
- 替代已有 API gateway。

关键边界：reasoning_content repair 是 stateful best-effort，不是 stateless magic fix。只有当相关请求和响应从一开始都经过 proxy，proxy 才可能保存并回放必要状态。如果用户直接给 proxy 一个已经丢失 `reasoning_content` 的 `messages` 数组，proxy 只能诊断缺失，不能凭空恢复。

#### G. Schema repair，v0.2+

Schema repair 是 linter 的可选升级能力，不默认静默修改用户 schema。

模式：

```bash
deepseek-compat-kit repair-schema ./tools.schema.json --dry-run
deepseek-compat-kit repair-schema ./tools.schema.json --apply
deepseek-compat-kit repair-schema ./tools.schema.json --apply --emit-prompt-constraints
```

规则：

- `lint` 只报告不兼容字段和风险字段。
- `repair --dry-run` 展示会删除、改写或降级哪些字段。
- `repair --apply` 生成 DeepSeek strict mode 兼容 schema。
- `--emit-prompt-constraints` 把被删除的自然语言约束输出为 system prompt 片段。
- 所有被 schema 降级的约束都必须进入 post-validation plan，提醒用户在工具执行前或执行后用应用代码校验。

重要原则：把 `minLength`、`maxItems` 等字段转写进 system prompt 不是等价替代。真正可靠的策略是 schema 降级 + prompt 提醒 + 应用层校验。

#### H. JavaScript/TypeScript SDK shim，v0.2

v0.2 再提供显式 SDK 集成：

```ts
import { createDeepSeekCompatClient } from "@deepseek-compat-kit/core";

const client = createDeepSeekCompatClient({
  apiKey: process.env.DEEPSEEK_API_KEY,
  model: "deepseek-v4-flash",
});
```

#### I. Compatibility test suite，v0.2+

v0.1 只做 offline contract tests 和最小 proxy tests。v0.2 再覆盖 OpenAI JS/Python、LangChain、vLLM、OpenRouter 等组合。

测试分两类：

- Offline contract tests：不打真实 API，只验证 message/schema 转换。
- Live provider tests：需要 `DEEPSEEK_API_KEY`，用于真实调用 DeepSeek API。

## 6. 技术架构

### 6.1 Monorepo 结构建议

```text
deepseek-compat-kit/
  README.md
  PROJECT_PLAN.md
  LICENSE
  package.json
  pyproject.toml
  packages/
    core-rules/
      src/
      tests/
    core-js/
      src/
      tests/
    core-py/
      deepseek_compat_kit/
      tests/
    cli/
      src/
      tests/
    schema-linter/
      src/
      tests/
    replay/
      src/
      tests/
    sanitizer/
      src/
      tests/
    proxy/
      src/
      tests/
  fixtures/
    tool-calls/
    schemas/
    provider-responses/
    reproductions/
    sanitized/
  docs/
    errors/
      reasoning-content-400.md
      strict-schema-unsupported-fields.md
    deepseek-v4-migration.md
    tool-calling-guide.md
    schema-compatibility.md
    schema-repair.md
    replay-debugger.md
    local-proxy.md
    github-issue-triage.md
    terminal-diagnostics.md
    provider-matrix.md
    known-failures.md
  examples/
    node-openai-sdk/
    python-openai-sdk/
    langchain-js/
    langchain-python/
    local-proxy-baseurl/
    vllm-openai-compatible/
  .github/
    workflows/
```

### 6.2 核心模块边界

#### Provider Transform Core

职责：

- 定义 DeepSeek-specific 的 message、tool、schema、reasoning state 转换规则。
- 给 SDK shim、CLI、replay debugger、local proxy 提供同一套核心能力。
- 保持规则可序列化、可快照测试、可跨 TypeScript/Python 复用。
- 把错误码、诊断对象、repair plan、post-validation plan 统一成稳定 contract。

早期可以先以 TypeScript 实现为主，但 fixtures、错误码、JSON contract 必须语言无关。Python 版本优先复用 fixtures 和 contract，避免两套实现语义漂移。

#### Message Normalizer

职责：

- 输入不同 SDK/框架生成的 messages。
- 输出 DeepSeek 兼容的 messages。
- 保留原始内容用于 debug。
- 处理 assistant、tool、system、user 消息的字段差异。

#### Tool Call Adapter

职责：

- 标准化 tool call id、name、arguments。
- 处理 arguments 是字符串、对象、空值、非法 JSON 时的差异。
- 提供可配置的 argument repair 策略。

#### Reasoning State Manager

职责：

- 处理 DeepSeek V4 thinking/reasoning 内容在多轮工具调用中的状态。
- 在需要时把 reasoning 内容回填到下一轮。
- 防止把 reasoning 内容错误暴露到终端用户输出中。
- 明确区分“可回放状态”和“已丢失状态”。如果历史 assistant message 从未经过 DeepSeek CompatKit，或者 `reasoning_content` 在进入工具前已经丢失，只能诊断，不能恢复。
- 在 local proxy 中以单进程内存态保存短期 state；持久化、跨进程和分布式状态放到后续版本。

#### Schema Compatibility Layer

职责：

- 静态检查 tool schema。
- 输出错误、警告和修复建议。
- 可选生成 DeepSeek 兼容版本 schema。
- 可选生成 prompt constraints 和 post-validation plan。
- 明确标记哪些修复是安全等价转换，哪些只是兼容性降级。
- 检查 DeepSeek strict mode 的 endpoint 要求：需要使用 beta base URL。
- 检查 object schema 的 DeepSeek strict mode 规则：所有 properties 必须进入 `required`，并且必须设置 `additionalProperties: false`。

#### Replay Engine

职责：

- 读取调用日志。
- 重建 Agent 调用链。
- 复现失败。
- 输出最小复现和诊断报告。

#### Sanitizer

职责：

- 在生成公开 replay fixture 前默认脱敏。
- 移除 API key、Bearer token、authorization header、cookie、URL query secret。
- 遮盖 email、手机号、常见 access token。
- 默认不导出完整 `reasoning_content`，只保留结构信息、长度、hash 和是否存在。
- 默认截断或 hash tool result，除非用户显式允许保留。
- 为 issue 提交生成 safe fixture，并在报告中标记哪些字段被脱敏。

#### Local Proxy

职责：

- 暴露 OpenAI-compatible endpoint，让现有项目通过修改 `baseURL` 接入。
- 在请求进入 DeepSeek 前执行 schema lint/repair、message normalization、reasoning state tracking。
- 在响应返回后记录必要的 replay 信息和 usage 信息。
- 默认本地运行，默认不持久化敏感内容，提供脱敏日志开关。

Proxy 不能拥有独立业务规则。任何兼容逻辑都必须调用 Provider Transform Core。

Proxy 的 reasoning_content 修复是 stateful best-effort，不是 stateless magic fix。只有当相关请求和响应都经过 proxy，proxy 才能在单进程内存中保存并回放必要 state。对于已经丢失历史字段的 `messages`，proxy 只能诊断缺失并提示上游修复，不能凭空还原。

### 6.3 语言与工具建议

首选 TypeScript + Python 双实现。

TypeScript 用于覆盖前端工具链、Node Agent、OpenAI JS SDK、LangChain JS、OpenCode 类项目。Python 用于覆盖企业后端、LangChain Python、LlamaIndex、评测脚本。

建议技术栈：

- TypeScript: pnpm workspace, tsup, vitest, zod。
- Python: uv, pytest, pydantic。
- CLI: 早期可用 TypeScript 实现，后续 Python 也提供入口。
- 文档: VitePress 或 MkDocs，早期先 Markdown。
- CI: GitHub Actions。

## 7. 产品路线图

### 倒排时间线与首发原则

DeepSeek CompatKit 的时间规划必须围绕 2026-07-24 的旧模型停用日期倒排，但不能把交付卡在这一天。真正的机会在停用前 3 到 6 周，因为开发者会在这段时间集中搜索迁移方案、提交 issue、尝试替代 provider 配置。

考虑到项目采用 AI 辅助开发，执行节奏可以更激进。项目采用“先抢第一印象，再快速补齐可信度”的节奏：

- 2026-05-25 到 2026-05-28：完成项目骨架、README、核心 fixtures、replay 格式、provider transform contract，发布 v0.0.1 prerelease。
- 2026-05-29 到 2026-06-03：完成 core rules、schema lint、sanitize、replay/diagnose MVP、local proxy 最小可用版，发布 v0.1 public alpha。
- 2026-06-04 到 2026-06-10：打通 Node tool loop shim、reasoning state tracking、Docker 运行方式、live tests，发布 v0.2 beta。
- 2026-06-11 到 2026-06-20：集中补 examples、provider matrix、上游 issue 复现材料和第一轮迁移文章，开始主动传播。
- 2026-06-21 到 2026-07-10：根据真实用户反馈快速迭代，补 schema repair apply、replay minimize、known failures 页面。
- 2026-07-11 到 2026-07-24：留作迁移高峰缓冲期，只做稳定性修复、文档补洞和真实用户案例沉淀。
- 2026-07-25 之后：从兼容性修复转向 cache/cost observability 和 DeepSeek reliability layer。

首发原则：

- 不等功能完美再发布。v0.1 只要能稳定解决 DeepSeek V4 多轮 tool calling 的典型 400 问题，就应该公开。
- 抢第一优先于功能完整，但不能牺牲可信度。每个公开版本至少要有一个真实可运行 demo、一个 replay fixture、一个清晰错误解释。
- 发布路径优先本地 npm/CLI proxy，其次 Docker，Cloudflare Workers 作为后续实验路径。
- 传播重点不是“我们做了一个框架”，而是“你现有 Agent 迁移 DeepSeek V4 报错时，先跑这个诊断和 proxy”。
- 所有推广都必须附带可复现案例、错误解释和修复路径，避免空泛宣传。

### Phase 0：项目骨架与迁移痛点复现，2026-05-25 到 2026-05-28

目标：

- 建好 monorepo。
- 整理 DeepSeek V4 迁移文档。
- 复现 3 到 5 个常见 tool calling / reasoning state 失败模式。
- 写出第一批 fixtures。
- 定义 `deepseek-error-reproduce.json` 和 JSONL replay 格式。

交付：

- `README.md`
- `docs/deepseek-v4-migration.md`
- `docs/replay-debugger.md`
- `fixtures/tool-calls/*.jsonl`
- `fixtures/reproductions/*.json`
- 第一版 provider compatibility matrix。

成功标准：

- 一个新开发者能用 fixtures 理解项目要解决什么问题。
- 至少有 3 个真实或近真实失败案例可 replay。
- 至少有 1 个案例明确展示 reasoning state 丢失如何导致多轮 tool calling 失败。
- v0.0.1 prerelease 可以公开给熟人试用。

### Phase 1：Core rules + schema linter + replay/sanitize/proxy MVP，2026-05-29 到 2026-06-03

目标：

- 做出 provider transform core 的第一版 contract。
- 提供 CLI 可运行的 schema lint。
- 提供 replay/diagnose MVP。
- 提供 sanitize MVP。
- 提供 local proxy 最小可用版。
- 建立 offline contract tests。

交付：

- `deepseek-compat-kit lint-schema`
- `deepseek-compat-kit replay`
- `deepseek-compat-kit diagnose`
- `deepseek-compat-kit sanitize`
- `deepseek-compat-kit proxy`
- `DSK_SCHEMA_*` 错误码体系。
- `DSK_REASONING_*` 错误码体系。
- `fixtures/tool-calls/reasoning-content-lost.jsonl`
- 15 个以上 schema/message/replay/sanitize fixtures。

成功标准：

- 用户可以在不调用 DeepSeek API 的情况下发现大部分 tool schema 兼容问题。
- 用户可以把失败日志转换成可提交的 `deepseek-error-reproduce.json`。
- 用户可以用 `sanitize` 生成默认脱敏的 issue fixture。
- v0.1 public alpha 可以通过 `npx deepseek-compat-kit proxy --port 8787` 启动。
- local proxy 明确只承诺单进程内存态、官方 DeepSeek `/chat/completions` 和基础 streaming。

### Phase 2：Tool loop shim + Docker + live tests，2026-06-04 到 2026-06-10

目标：

- 打通 DeepSeek V4 + OpenAI SDK + 多轮 tool calling。
- 支持 streaming 和 non-streaming。
- 支持可插拔 tool executor。
- 提供 `repair-schema --dry-run`。
- 加强 local proxy 的 reasoning state tracking。
- 提供 Docker 一键运行方式。
- 跑通真实 DeepSeek API live tests。

交付：

- `createDeepSeekCompatClient()`
- Python `DeepSeekCompatClient` 最小版本。
- `normalizeMessages()` / `normalize_messages()`
- `deepseek-compat-kit repair-schema --dry-run`
- `examples/local-proxy-baseurl`
- Docker 一键启动方式。
- live tests。
- Node/Python examples。

成功标准：

- 能稳定跑通至少 5 个工具调用示例：天气查询、文件搜索、JSON 写入、代码执行 mock、数据库查询 mock。
- 失败时输出可读诊断，而不是只透传 400/500。
- 一个现有 OpenAI-compatible demo 只改 `baseURL` 后可以通过 local proxy 跑通 DeepSeek V4 多轮 tool calling。
- v0.2 beta 可以覆盖 npm/CLI proxy 和 Docker 两种主路径。

### Phase 3：生态例子、传播素材与上游协作准备，2026-06-11 到 2026-06-20

目标：

- 补齐最容易传播的 examples、known failures、provider matrix。
- 把真实 issue 常见问题整理成可引用材料。
- 形成第一轮对外文章和迁移 checklist。

交付：

- `docs/known-failures.md`
- `docs/provider-matrix.md` 完整初版。
- `examples/langchain-js`
- `examples/openai-js-baseurl-proxy`
- `examples/vllm-openai-compatible`
- 第一篇完整迁移指南。

成功标准：

- 外部开发者看到 README 后 5 分钟内能完成一次 proxy 试用。
- 相关 GitHub issue 中可以直接引用 known failures 和 replay fixture。

### Phase 4：功能补强、集中传播与迁移高峰稳定，2026-06-21 到 2026-07-24

目标：

- 与 LangChain、LlamaIndex、vLLM、OpenRouter、OpenCode 等生态建立兼容矩阵。
- 提供 adapter recipes。
- 争取被上游项目文档引用。
- 把常见问题整理成可被上游项目直接引用的 fixtures 和 issue comments。
- 补齐 schema repair apply、replay minimize、HTML/Markdown 诊断报告。

交付：

- `docs/provider-matrix.md`
- `examples/langchain-js`
- `examples/langchain-python`
- `examples/vllm-openai-compatible`
- `deepseek-compat-kit minimize`
- `deepseek-compat-kit repair-schema --apply`
- HTML/Markdown 诊断报告。
- GitHub issue templates。

成功标准：

- 至少 5 个外部项目 issue 可以引用本项目作为排查工具。
- 第一个月获得 100+ GitHub stars 或 10+ 外部 issue/PR。
- 2026-07-11 之后不再安排大功能，只保留 bugfix、文档和真实案例沉淀，确保迁移高峰期工具稳定。

### Phase 5：Agent reliability 与成本可观测性，2026-07-25 之后推进

目标：

- 从“兼容性修复”自然扩展到“Agent 可靠性与成本优化层”。
- 统计 tool call 成功率、重试率、schema repair 次数、reasoning state 丢失次数。
- 支持 DeepSeek context cache usage 解析、cache hit/miss 统计、prompt prefix 对齐建议。

交付：

- `deepseek-compat-kit report-cost`
- `deepseek-compat-kit analyze-cache`
- `docs/context-cache-observability.md`
- local proxy 的可选 usage log export。

成功标准：

- 用户即使不再遇到 V4 迁移 bug，也仍然有理由保留 DeepSeek CompatKit：它能帮他们降低成本、发现 Agent 可靠性问题、给生产系统做回归观测。

## 8. 关键设计决策

### 8.1 Core-first，CLI/replay 首发，不急着做 Web UI

早期用户是开发者和框架维护者，他们更需要可集成、可测试、可在 CI 跑的工具。Web UI 好看但不一定带来核心价值。Replay debugger 的报告可以先输出 Markdown/HTML 文件，等核心逻辑稳定后再做可视化。

第一优先级是 provider transform core、CLI、fixtures 和 replay。SDK shim 与 local proxy 都应该调用同一套核心规则，这样后续无论用户选择显式集成库，还是只改 `baseURL`，行为都一致。

### 8.2 保持 provider-neutral 的边界，但 DeepSeek-first

项目可以支持 OpenAI-compatible 和 Anthropic-compatible 两种接口，但产品叙事必须 DeepSeek-first。否则会变成泛泛的 LLM compatibility kit，范围过大。

### 8.3 错误码和 fixtures 是项目资产

代码本身不一定复杂，真正的护城河是：

- 对 DeepSeek 真实行为的系统化归档。
- 可复现的失败 fixtures。
- 错误码和修复建议。
- provider compatibility matrix。

### 8.4 不隐藏模型差异

不要假装 DeepSeek 与 OpenAI/Anthropic 完全一样。适配层应该明确告诉用户差异在哪里、为什么要这样转换、何时可能丢信息。

### 8.5 Proxy 是采用层，不是主产品边界

Local proxy 的价值是低侵入接入：开发者可以先把已有项目的 `baseURL` 指向 DeepSeek CompatKit，快速验证是否能解决 V4 迁移问题。但 proxy 不能让项目变成通用 API gateway。早期 proxy 要少承诺，只覆盖 DeepSeek V4 的兼容性、诊断、replay 和基础可观测性。

Proxy 的能力边界必须在 README 和错误页里写硬：reasoning_content repair 是 stateful best-effort。只有当一段会话从相关请求开始就经过 proxy，proxy 才能保存上一轮 assistant response 中的 reasoning state 并在后续请求中帮助回放。如果用户把一个已经丢失 `reasoning_content` 的历史 `messages` 直接发给 proxy，proxy 不能凭空恢复，只能诊断并给出上游修复建议。

部署优先级：

1. 本地 npm/CLI proxy：首发主路径。适合开发者最快试用，API key 不出本机，状态可以先存在本地内存。
2. Docker：第二主路径。适合后端团队、企业内网和自托管环境，更容易接入日志、脱敏和进程管理。
3. Cloudflare Workers：后续实验路径。适合做轻量共享 proxy 或 hosted demo，但不作为 v0.1 的主交付，因为它需要额外处理 secrets、状态存储、streaming、CPU 限制和日志隐私。

首发命令应该尽量短：

```bash
npx deepseek-compat-kit proxy --port 8787
```

README 第一屏必须展示如何把 OpenAI-compatible client 的 `baseURL` 改为：

```text
http://127.0.0.1:8787/v1
```

### 8.6 Schema repair 必须显式、可审计、可回滚

Schema repair 不能默认静默执行。所有自动降级都必须输出 repair report，并标记：

- 删除了哪些 JSON Schema 字段。
- 哪些约束被转写成 prompt constraints。
- 哪些约束需要应用层 post-validation。
- 修复后的 schema 与原 schema 的差异。

任何“转写进 prompt”的约束都只能视为弱约束，不能视为 strict schema 的等价替代。

## 9. 测试策略

### 9.1 Offline tests

不依赖 API key，默认在 CI 中运行。

覆盖：

- schema lint snapshots。
- schema repair snapshots。
- message normalization snapshots。
- tool call argument parsing。
- reasoning state transitions。
- replay engine diagnostics。
- sanitizer redaction snapshots。
- local proxy request/response transform contract。

### 9.2 Live tests

需要 `DEEPSEEK_API_KEY`，在手动 CI 或 nightly CI 中运行。

覆盖：

- V4 flash/pro 基本对话。
- 单轮 tool call。
- 多轮 tool call。
- streaming tool call。
- local proxy baseURL 接入。
- strict mode schema。
- JSON output。
- context caching usage 字段解析。

v0.1 不要求 live tests 全覆盖。v0.1 的 live 验证只需要确认 official DeepSeek `/chat/completions`、基础 tool calling、strict schema lint 规则与官方行为一致。完整 live compatibility matrix 从 v0.2 开始补齐。

### 9.3 Compatibility matrix

矩阵维度：

- Model: `deepseek-v4-flash`, `deepseek-v4-pro`。
- SDK: OpenAI JS, OpenAI Python, Anthropic compatible client。
- Runtime: official DeepSeek API, vLLM, OpenRouter。
- Framework: LangChain JS/Python, LlamaIndex, OpenCode。
- Mode: streaming, non-streaming, tool calling, strict schema, local proxy。

输出状态：

- PASS
- PARTIAL
- FAIL
- UNKNOWN

每个状态必须链接到 fixture、测试或 issue。

v0.1 compatibility matrix 只标注 `official DeepSeek API + OpenAI-compatible /chat/completions + local proxy`。OpenAI Python、LangChain、LlamaIndex、OpenCode、vLLM、OpenRouter 等状态可以先标为 UNKNOWN，并链接到后续计划，避免首发承诺过宽。

## 10. 开源运营计划

### 10.1 仓库首屏

README 第一屏要讲清楚：

- DeepSeek legacy models `deepseek-chat` 和 `deepseek-reasoner` 计划在 2026-07-24 停用。
- DeepSeek Agent 接入为什么会失败。
- 完整错误字符串：`The reasoning_content in the thinking mode must be passed back to the API`。
- 这个项目如何在 5 分钟内定位问题。
- 一个最小示例。
- 一个只改 `baseURL` 的 local proxy 示例。
- 明确说明 local proxy 的 reasoning_content repair 是 stateful best-effort，不能恢复已经丢失的历史字段。
- 兼容矩阵状态。

建议 README 标语：

```text
Make DeepSeek tool-calling agents boringly reliable.
```

README 第一屏建议结构：

```text
# DeepSeek CompatKit

Compatibility and diagnostics for DeepSeek V4 tool-calling agents.

Legacy model migration: deepseek-chat and deepseek-reasoner are scheduled for deprecation on 2026-07-24.

Fix and diagnose:
"The reasoning_content in the thinking mode must be passed back to the API"

npx deepseek-compat-kit proxy --port 8787
baseURL = "http://127.0.0.1:8787/v1"
```

GitHub About / Topics 建议包含：

- `deepseek`
- `deepseek-v4`
- `tool-calling`
- `reasoning-content`
- `openai-compatible`
- `llm-proxy`
- `agent-debugging`
- `json-schema`
- `vllm`
- `langchain`
- `llamaindex`

必须建立 SEO 错误页：

- `docs/errors/reasoning-content-400.md`
- `docs/errors/strict-schema-unsupported-fields.md`

`docs/errors/reasoning-content-400.md` 必须原样包含错误字符串、触发条件、最小复现、诊断命令、proxy 临时方案和上游修复建议。

错误页必须写清楚：如果 `reasoning_content` 在请求进入 DeepSeek CompatKit 之前已经丢失，proxy 只能诊断缺失，不能凭空还原。local proxy 的临时缓解能力依赖相关请求和响应从一开始都经过 proxy。

### 10.2 Issue 模板

至少提供四种模板：

- Tool calling failed
- Schema compatibility issue
- Provider/runtime compatibility issue
- Framework integration request
- Replay fixture submission

模板要求用户附上：

- model
- SDK/framework
- runtime/provider
- streaming or non-streaming
- sanitized request/response
- replay fixture

### 10.3 GitHub Issue 技术施援模板

这是最重要的早期获客渠道，但必须以工程协助的方式出现。只在问题高度相关时回复，不能批量复制粘贴。

适合回复的信号：

- issue 中出现 `reasoning_content`。
- issue 中出现 `The reasoning_content in the thinking mode must be passed back to the API`。
- issue 描述 DeepSeek V4 + tool calling + 第二轮/第三轮请求 400。
- issue 描述 strict schema、`minLength`、`maxItems`、`additionalProperties`、required 字段问题。

不适合回复的场景：

- 用户只是讨论模型质量、价格、延迟。
- issue 已有明确上游修复 PR 且不需要临时 workaround。
- 与 DeepSeek V4、tool calling、schema strict mode 无关。

建议回复结构：

```text
I think this is likely the DeepSeek V4 reasoning_content round-trip issue.

Root cause: in thinking mode, if the assistant produces tool calls, the next request needs to pass back the assistant message including reasoning_content. Some OpenAI-compatible agent loops drop that field between turns, so DeepSeek returns:

"The reasoning_content in the thinking mode must be passed back to the API"

Minimal check:
1. Inspect the assistant tool_call message from the previous turn.
2. Confirm whether reasoning_content is preserved in the next request.
3. If it is missing, the framework needs to round-trip that field.

Temporary local workaround while the upstream fix lands:

npx deepseek-compat-kit proxy --port 8787

Then point the OpenAI-compatible baseURL to:

http://127.0.0.1:8787/v1

The project also includes a replay fixture format so this can be reduced into a small reproducible case:
<link to docs/errors/reasoning-content-400.md>
```

回复原则：

- 必须先解释根因，再给工具链接。
- 必须承认这是临时兼容/诊断方案，不替代上游修复。
- 如果能给上游提供 PR 或 fixture，优先提供 PR/fixture。
- 不使用“唯一解决方案”“降维打击”“官方没修好”等攻击性措辞。

### 10.4 终端诊断日志规范

终端输出要有“看得见的价值”，但不能做成噱头。目标是让开发者清楚看到 DeepSeek CompatKit 帮他阻止了什么错误、做了什么兼容转换、还有哪些风险需要自己处理。

推荐日志风格：

```text
[deepseek-compat-kit] proxy listening on http://127.0.0.1:8787/v1
[deepseek-compat-kit] DSK_REASONING_001 prevented on turn 3
[deepseek-compat-kit] restored reasoning_content for assistant tool_call call_abc123
[deepseek-compat-kit] DSK_SCHEMA_001 minLength is unsupported by DeepSeek strict mode
[deepseek-compat-kit] repair plan: remove minLength, add post-validation requirement
```

日志规范：

- 默认使用清晰文本和少量颜色，不使用夸张渐变、emoji 密集输出或不可复制的格式。
- 对外宣传截图应展示真实诊断，不展示虚构的 saved money。
- 成本/缓存统计必须来自真实 usage 字段，例如 `prompt_cache_hit_tokens` 和 `prompt_cache_miss_tokens`。
- 禁止使用“Automatically injected cached tokens”这类不准确说法。正确表述是 restored/replayed `reasoning_content` 或 aligned prompt prefix。
- 默认不打印 API key、完整 prompt、tool result 敏感内容；需要脱敏策略。

### 10.5 贡献者入口

适合新贡献者的任务：

- 添加失败 fixture。
- 添加 schema lint rule。
- 添加 provider matrix 条目。
- 添加框架 example。
- 改进错误文案。

### 10.6 传播切入点

内容策略：

- “DeepSeek V4 tool calling migration guide”
- “Fixing DeepSeek V4 reasoning_content round-trip errors”
- “Why OpenAI-compatible does not mean behavior-compatible”
- “Debugging DeepSeek multi-turn tool calls”
- “DeepSeek strict mode schema checklist”
- “Use DeepSeek CompatKit as a local proxy by changing baseURL”
- “DeepSeek vs OpenAI tool call message format differences”
- “The reasoning_content in the thinking mode must be passed back to the API: root cause and fix”

这些文章比单纯发项目链接更容易获得开发者传播。

### 10.7 推广时间表

推广目标不是“到处发链接”，而是在 DeepSeek V4 迁移窗口里尽早成为相关问题的默认答案。节奏要提前，7 月 24 日前最后两周用于稳定和回应用户，不安排大规模新功能。

#### 2026-05-29 到 2026-06-03：Alpha 首发预热

目标：

- 让第一批开发者知道项目存在。
- 收集最早的真实报错样本。
- 验证 `npx deepseek-compat-kit proxy --port 8787` 是否足够顺手。

动作：

- 发布 README、quickstart、1 个 Node example、1 个 replay fixture。
- 在个人 X、V2EX、GitHub Discussions 或技术社群发第一篇短文。
- 标题聚焦实际痛点，例如：“DeepSeek V4 tool calling 报 400 时，如何定位 reasoning_content 丢失”。
- 邀请 5 到 10 个熟悉 Agent 开发的朋友试用，不追求大规模传播。

#### 2026-06-04 到 2026-06-10：Beta 公开发布

目标：

- 把项目从“能跑”推到“可信”。
- 让外部 issue 可以引用本项目的复现格式和诊断报告。

动作：

- 发布 v0.2 beta，包含 replay debugger、schema repair dry-run、local proxy alpha、Docker 方式。
- 写一篇完整迁移指南：《DeepSeek 老模型停用前，Agent 项目迁移 V4 的工具调用检查清单》。
- 在相关 GitHub issue 中参与讨论时，只在确实匹配的问题下留言，附上最小复现、错误解释和工具链接。
- 维护 `docs/provider-matrix.md`，把 OpenAI JS、OpenAI Python、LangChain、LlamaIndex、OpenCode、vLLM、OpenRouter 的状态标出来。

#### 2026-06-11 到 2026-06-30：迁移窗口集中传播

目标：

- 抢占“DeepSeek V4 migration / reasoning_content 400 / strict schema”相关搜索心智。
- 让项目成为迁移问题的自然引用链接。

动作：

- 发布 2 到 3 篇高信号文章：
  - “Fixing DeepSeek V4 reasoning_content round-trip errors”
  - “DeepSeek strict mode schema compatibility checklist”
  - “Use DeepSeek CompatKit as a local proxy by changing baseURL”
- 针对真实 issue 提供可复制的 `deepseek-error-reproduce.json`，鼓励用户提交脱敏 fixture。
- 整理 “known failures” 页面，把常见错误码、触发条件、修复方式写清楚。
- 准备 Hacker News、X、V2EX、Reddit/LocalLLaMA 等渠道的发布帖，但内容必须有技术细节和可运行示例。

#### 2026-07-01 到 2026-07-24：迁移高峰稳定期

目标：

- 保持工具稳定，快速回应用户。
- 把真实案例转化为 fixtures 和文档。

动作：

- 暂停大功能开发，只做 bugfix、文档、兼容矩阵和案例整理。
- 每周发布一次小版本，修复真实用户报告的问题。
- 在 README 顶部加入“距离旧模型停用还有 X 天”的迁移提示，停用后移除。
- 标注推荐版本，例如 `v0.2.x` 为迁移高峰稳定版本。

#### 2026-07-25 之后：转向长期价值

目标：

- 不让项目随着迁移窗口结束而衰减。
- 把用户留存在 cache/cost observability 和 reliability tooling 上。

动作：

- 发布 `analyze-cache`、`report-cost` 的 early preview。
- 写 DeepSeek context cache 命中率优化指南。
- 把 local proxy 的 usage log export 与 replay/debugger 结合起来，形成生产可观测性故事。

### 10.8 推广原则

- 争当第一，但不刷屏。只在问题高度相关时出现，并提供可复现材料。
- 每一次对外传播都要带一个能运行的命令、一个错误解释或一个 fixture。
- 不攻击上游框架。定位是帮助迁移和补充诊断，尽量给上游提供可合并的复现和修复建议。
- 不夸大 proxy 能力。明确它是兼容诊断与迁移工具，不是生产级通用 LLM Gateway。
- 把每个真实用户问题沉淀成 fixtures、错误码、文档或测试，避免同一个坑反复人工解释。

明确不采用：

- 不做批量复制粘贴式 issue 营销。
- 不在无关 issue、无关 Reddit 帖或无关社群里贴项目链接。
- 不宣称可以百分百修复所有 DeepSeek V4 迁移问题。
- 不把 `reasoning_content` 回放说成 “cache token 注入”。
- 不展示没有真实 usage 支撑的“节省金额”。
- 不使用贬低 LangChain、LlamaIndex、OpenCode、RooCode、vLLM 等上游项目的表达。

## 11. 风险与对策

### 风险 1：DeepSeek 官方很快修复或改变行为

对策：项目定位为兼容性测试和迁移工具，而不是只修一个 bug。即使官方行为变化，compatibility matrix、fixtures、migration docs 仍然有价值。

### 风险 2：范围扩张成通用 Agent 框架

对策：明确不做 planning、memory、workflow、UI builder。所有功能都围绕 DeepSeek provider 兼容性。

### 风险 3：真实 API 测试成本和不稳定性

对策：默认 offline tests，live tests 放到手动或 nightly；fixtures 必须脱敏和可回放。

### 风险 4：Python/TypeScript 双栈维护压力

对策：先把规则、fixtures、错误码定义成语言无关资产。TypeScript 先行，Python 只实现稳定核心。等社区反馈明确后再扩展。

### 风险 5：与上游框架边界不清

对策：优先做 recipes 和 adapters，不强行 fork 框架。对 LangChain/LlamaIndex 等生态，目标是补兼容层和测试，不替代它们。

### 风险 6：上游框架快速修复，早期兼容补丁价值下降

对策：把早期流量沉淀为长期资产。即使 LangChain、LlamaIndex、OpenCode 等项目逐步原生修复 DeepSeek V4 的 tool-tracking 问题，DeepSeek CompatKit 仍然保留 replay debugger、fixtures、schema repair、provider matrix、cache/cost observability 的价值。

### 风险 7：Local proxy 让用户误以为这是生产级 API 网关

对策：文档中明确 proxy alpha 的边界。早期 proxy 默认本地运行，强调调试、迁移和兼容诊断，不承诺多租户、高可用、复杂路由、企业鉴权。生产自托管能力可以后续演进，但不能拖慢核心兼容能力。

### 风险 8：Schema auto-repair 引入隐性行为变化

对策：repair 必须显式触发，默认 dry-run。所有自动修改都输出 diff、prompt constraints 和 post-validation plan。任何非等价降级都标记为 warning，并建议用户在应用层验证。

### 风险 9：Replay fixture 泄露敏感信息

对策：sanitize 前置到 v0.1。默认不导出完整 `reasoning_content`、tool result、authorization header、cookie、API key、Bearer token、URL query secret、email、手机号等内容。公开 fixture 使用 allowlist 策略，并在诊断报告中标记哪些字段被脱敏。

### 风险 10：用户误以为 proxy 可以恢复已经丢失的历史状态

对策：README、错误页、proxy 启动日志都必须明确说明：reasoning_content repair 是 stateful best-effort，只有相关请求/响应从一开始经过 proxy 才可能回放。对于已经丢失历史字段的 `messages`，DeepSeek CompatKit 只能诊断，不能还原。

## 12. 商业化可能性

开源核心保持免费，后续可探索：

- 企业 DeepSeek Agent 兼容性审计。
- 私有化 provider compatibility dashboard。
- CI 插件或 GitHub App。
- 团队级调用日志 replay 与脱敏分析。
- DeepSeek 迁移咨询和测试套件。

但早期不要急于商业化。先把项目做成 DeepSeek Agent 生态里“遇到兼容问题先跑一下”的默认工具。

## 13. 第一周具体任务

第 1 天，2026-05-25：

- 初始化 monorepo。
- 写 README 草稿。
- 建立 docs/fixtures/examples 目录。
- 建立 `docs/errors/` 目录。
- 收集官方文档链接和已知 issue。
- 定义 provider transform core 的 JSON contract 草案。

第 2 天，2026-05-26：

- 定义 replay fixture JSONL 格式。
- 定义 `deepseek-error-reproduce.json` 格式。
- 手写 3 个失败 fixture，其中至少 1 个是 reasoning state 丢失案例。
- 写 `docs/provider-matrix.md` 第一版。
- 写 `docs/errors/reasoning-content-400.md` 第一版。

第 3 天，2026-05-27：

- 实现 TypeScript schema linter 最小版本。
- 支持 5 到 8 条 lint rule，其中必须包含 `/beta` base URL、all properties required、`additionalProperties: false`。
- 实现 `sanitize` 最小版本。
- 加 vitest snapshot。

第 4 天，2026-05-28：

- 实现 message normalizer。
- 实现 reasoning state checker。
- 加 OpenAI-style message fixtures。
- 输出诊断对象。
- 写 `docs/github-issue-triage.md` 和 issue 技术施援模板。
- 发布 v0.0.1 prerelease。

第 5 天，2026-05-29：

- 实现 CLI `lint-schema`、`diagnose` 雏形。
- 实现 CLI `sanitize` 雏形。
- 实现 `replay` MVP。
- 完成最小 Node request fixture/example。
- 写第一篇 `docs/tool-calling-guide.md`。
- 写 `docs/terminal-diagnostics.md`。
- 开始 local proxy 最小路由实现。

第 6-7 天，2026-05-30 到 2026-05-31：

- 跑真实 DeepSeek API live test。
- 根据真实返回修正规则。
- 完成 local proxy alpha 的最小路由和日志脱敏方案。
- 写 v0.0.1 发布帖草稿和 quickstart 截图/终端输出。
- 准备 v0.1 public alpha 发布清单。

## 14. v0.0.1 发布标准

必须完成：

- `README.md` 可以让用户 5 分钟内跑起来。
- `lint-schema` 可用。
- `sanitize` 可用，默认不导出完整 `reasoning_content` 和 tool result。
- `replay` / `diagnose` 可用。
- 至少 10 个 schema/replay/sanitize fixtures。
- 至少 10 个 offline tests。
- 一个最小 Node request fixture/example。
- `provider-matrix.md` 有第一版。
- `docs/errors/reasoning-content-400.md` 有第一版。
- `docs/github-issue-triage.md` 有第一版。
- README 原样包含 `The reasoning_content in the thinking mode must be passed back to the API`。
- 所有错误码有解释和修复建议。
- README 明确标注 v0.1 public alpha 的目标日期：2026-06-03。

可延期：

- Web UI。
- 完整 Python SDK。
- Python message normalization example。
- `repair-schema --dry-run`。
- LlamaIndex 深度适配。
- 自动最小化 replay。
- local proxy production mode。
- CI GitHub App。

## 15. v0.1 / v0.2 发布标准

### v0.1 public alpha，目标日期 2026-06-03

必须完成：

- `npx deepseek-compat-kit proxy --port 8787` 可启动本地 proxy。
- 现有 OpenAI-compatible client 只改 `baseURL` 可以跑通至少一个多轮 tool calling demo。
- reasoning state 丢失能被诊断，并输出 `DSK_REASONING_*` 错误码。
- README 明确说明 proxy 的 reasoning_content repair 是 stateful best-effort，不是 stateless magic fix。
- proxy 只承诺单进程内存态、官方 DeepSeek `/chat/completions`、基础 streaming。
- `deepseek-error-reproduce.json` 可生成、可 replay。
- sanitized replay fixture 可生成，默认隐藏 API key、Bearer token、tool result、完整 `reasoning_content`。
- README 第一屏包含 proxy quickstart、diagnose quickstart、schema lint quickstart。
- README、GitHub About 建议和 docs/errors 已覆盖核心 SEO 关键词。
- 至少 1 篇迁移/排障文章公开发布。

可延期：

- Cloudflare Workers 部署。
- 完整 Python SDK。
- `createDeepSeekCompatClient()` SDK shim。
- LangChain/LlamaIndex examples。
- vLLM/OpenRouter 深度适配。
- 可视化 dashboard。
- 高级 cache/cost analysis。

### v0.2 beta，目标日期 2026-06-10

必须完成：

- Docker 一键启动方式。
- Node tool loop shim 可跑通多轮 tool calling demo。
- `createDeepSeekCompatClient()` SDK shim 初版。
- `repair-schema --dry-run` 可用，并输出 repair plan。
- local proxy 能处理 reasoning state tracking 的典型路径。
- 至少 1 个 DeepSeek API live test 通过。
- `docs/provider-matrix.md` 至少覆盖 OpenAI JS、OpenAI Python、LangChain、LlamaIndex、OpenCode、vLLM、OpenRouter。
- 至少 5 个真实或近真实 failure fixtures。
- 至少 2 篇技术文章或迁移指南。

可延期到 2026-06-21 前完成：

- `repair-schema --apply`，并输出 diff、prompt constraints、post-validation plan。
- `replay minimize` 初版。
- HTML/Markdown 诊断报告。

成功标准：

- 2026-06-11 进入集中传播期时，项目已经不是概念稿，而是有可运行命令、可复现案例、可引用文档和可提交 issue 模板的工具。

## 16. 参考资料

- DeepSeek API 更新日志：https://api-docs.deepseek.com/updates
- DeepSeek API 价格：https://api-docs.deepseek.com/quick_start/pricing
- DeepSeek Tool Calls 文档：https://api-docs.deepseek.com/guides/tool_calls
- DeepSeek Thinking Mode 文档：https://api-docs.deepseek.com/guides/thinking_mode
- DeepSeek Context Caching 文档：https://api-docs.deepseek.com/guides/kv_cache
- DeepSeek GitHub：https://github.com/deepseek-ai
- DeepSeek Awesome Integration：https://github.com/deepseek-ai/awesome-deepseek-integration
- Hugging Face DeepSeek 生态回顾：https://huggingface.co/blog/huggingface/one-year-since-the-deepseek-moment-blog-3
- OpenCode DeepSeek V4 tool call 兼容 issue：https://github.com/anomalyco/opencode/issues/24190
- vLLM DeepSeek V4 tool parser 兼容 issue：https://github.com/vllm-project/vllm/issues/41240

## 17. 项目命名决策

正式名称：

- 显示名：DeepSeek CompatKit
- GitHub 仓库名：`deepseek-compat-kit`
- npm 包名：`@deepseek-compat-kit/core`
- Python 包名：`deepseek-compat-kit`
- Python import 名：`deepseek_compat_kit`
- CLI 名：`deepseek-compat-kit`

已确认采用：

- `deepseek-compat-kit`

备选：

- `deepseek-compat`
- `deepseek-agent-compat`
- `deepseek-toolkit`
- `deepseek-provider-kit`

建议使用 `deepseek-compat-kit`，因为它准确表达“DeepSeek 兼容性工具包”的定位，同时比 `deepseek-compat` 更有产品延展性，后续承载 schema linter、replay debugger、provider matrix 和 SDK shim 都自然。
