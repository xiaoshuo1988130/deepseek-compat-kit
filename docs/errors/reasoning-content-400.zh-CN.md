# DeepSeek V4 reasoning_content 400 错误

本文解释 DeepSeek V4 的常见错误：

```text
The reasoning_content in the thinking mode must be passed back to the API
```

## 为什么会发生

在 DeepSeek V4 thinking mode 中，如果 assistant 响应里包含 tool calls，也可能包含 `reasoning_content`。同一个工具调用循环里的下一次请求，需要保留相关 assistant message 的推理状态。

很多 OpenAI-compatible Agent 框架在多轮 tool calling 时，只保留通用字段，丢掉 provider-specific 字段，于是下一轮请求到达 DeepSeek 时缺少 `reasoning_content`，最终返回 HTTP 400。

常见失败链路：

1. 用户发送请求。
2. DeepSeek 返回带 tool calls 和 reasoning state 的 assistant message。
3. 框架执行工具。
4. 框架构造下一轮请求，但丢掉 `reasoning_content`。
5. DeepSeek 返回 HTTP 400。

## 最小诊断

检查上一轮 assistant tool-call message 和下一轮发给 DeepSeek 的 request。

重点看：

- assistant response 中是否有 `reasoning_content`。
- 下一轮 request 是否保留了这个字段。
- tool call id 是否稳定。
- 下一轮 request 是否包含匹配的 tool result。

## 临时本地 Proxy

运行：

```bash
npx deepseek-compat-kit proxy --port 8787
```

然后把 OpenAI-compatible client 的 `baseURL` 指向：

```text
http://127.0.0.1:8787/v1
```

## 重要边界

proxy 是 **stateful best-effort** 缓解方案，不是 stateless magic fix。

只有当相关请求和响应从对话开始就经过 proxy，proxy 才可能保存并回放 reasoning state。如果你的框架传来的 `messages` 数组在进入 proxy 前已经丢失 `reasoning_content`，DeepSeek CompatKit 只能诊断缺失，不能凭空还原。

## 安全提交 Issue Fixture

公开分享日志前，请先脱敏：

```bash
npx deepseek-compat-kit sanitize ./logs/deepseek-run.jsonl --out ./safe-replay.jsonl
```

默认情况下，脱敏 fixture 不应包含 API key、Bearer token、完整 tool result 或完整 `reasoning_content`。

## 上游修复方向

框架应该在 tool-call turns 之间保留 DeepSeek provider-specific assistant 字段。长期来看，上游框架修复比长期依赖本地 proxy 更可靠。
