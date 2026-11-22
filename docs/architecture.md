# 架构与 Hook 顺序

## 当前状态

[包清单](../package.json)将 [单文件中间件](../paseo-factory-mcp.middleware.js)交给 Magpie。插件无运行依赖。范围由 `ctx.agent === "claude"`、`ctx.protocol === "anthropic"`、`/v1/messages` 和 Provider 元组 `{ id: "factory", account: "plugin" }` 共同确定。自定义转发端点即便显示名相同，也不会触发。[Provider 标识来源](https://github.com/yetone/magpie/blob/f0b58041df3c5031b42c788429288cf95b6c4e11/internal/provider/plugins.go#L588-L655)

`onProvider` 为每次候选清除旧映射，再收集本次顶层声明和结构化延迟定义。匹配 `mcp__<命名空间>__<工具名>` 的名称从前缀后第一个能划分出两个有效部分的双下划线分隔。两个部分都须非空并由 ASCII 字母、数字、下划线或连字符组成。别名优先采用命名空间和工具名拼成的可读名称。长名或冲突使用确定性备用别名，插件生成的别名上限为 64 个字符。分配顺序由原名决定，重复声明共享别名。

分配前预留本次声明、显式选择、历史 `tool_use` 和结构化引用中的名称。显式选择、历史调用和结构化引用随有效声明同步，只有历史引用时保持原样。请求不改变调用 ID、工具参数、Thinking 或签名。

`onEvent` 处理客户端 SSE 的工具调用起始帧，`onResponse` 处理成功的非流式 Messages 回包。两者依据请求级映射恢复该次转换过的工具名。错误响应、流内错误、其他工具、结果 ID 和工具入参保持原状。插件不发起请求，不接管 Factory 插件的重试。

## 已核对的上游行为

1. Magpie 通过包清单中的 `magpie.middleware` 发现模块，在 Gateway 进程内用 moejs 执行。Factory Provider 插件在 Bun 插件宿主中运行。两个扩展点具有独立运行时。[Magpie 插件文档](https://usemagpie.ai/docs/plugins#middleware)
2. `serveAgent` 先调用 `onRequest`，再进入路由。路由对每个候选尝试调用 `onProvider`，它看到客户端协议的 body，`ctx.provider` 含 `id`、`name`、可选的 `account` 和 `model`。每次候选尝试独立取输入 body。Factory Provider 之后才执行自己的请求适配。[Gateway 请求入口](https://github.com/yetone/magpie/blob/e5c2eb9415011e668b20baca25f364bc47402d6b/internal/gateway/middleware.go#L46-L112) · [路由调用点](https://github.com/yetone/magpie/blob/e5c2eb9415011e668b20baca25f364bc47402d6b/internal/gateway/gateway.go#L4277) · [Factory 调用点](https://github.com/magpie-community/plugins/blob/3f2c56ddc770846494abaae1330f5d736147ec88/packages/factory/index.mjs#L2462-L2473)
3. Factory 已有别名逻辑对声明及与声明匹配的历史调用和显式工具选择保持一致。其批量分支跳过以 `mcp__` 开头的名称。Factory Provider 先按本次发送生成的映射恢复 JSON 或流式工具名，Gateway 再对客户端协议的响应运行 `onEvent` 或 `onResponse`。[Factory 别名模块](https://github.com/magpie-community/plugins/blob/3f2c56ddc770846494abaae1330f5d736147ec88/packages/factory/tool-names.mjs#L92-L161) · [Factory 恢复入口](https://github.com/magpie-community/plugins/blob/3f2c56ddc770846494abaae1330f5d736147ec88/packages/factory/tool-names.mjs#L254-L266) · [Gateway 响应处理](https://github.com/yetone/magpie/blob/e5c2eb9415011e668b20baca25f364bc47402d6b/internal/middleware/run.go#L367-L427)
4. 同一请求内每个模块共用 `ctx.state`。源码在每次 `onProvider` 前写入候选 Provider，响应 Hook 读取同一上下文，响应路径没有单独注入已胜出的 Provider。Gateway 可能在 `onProvider` 之后跳过该候选，因此还需要在真实 Gateway 桩测试中验证路由回退和错误路径。社区 Bun 测试助手用浅拷贝向 `onProvider` 传入 Provider，和 Go 运行时的上下文行为有差异。[上下文实现](https://github.com/yetone/magpie/blob/e5c2eb9415011e668b20baca25f364bc47402d6b/internal/middleware/run.go#L167-L205) · [候选跳过分支](https://github.com/yetone/magpie/blob/e5c2eb9415011e668b20baca25f364bc47402d6b/internal/gateway/gateway.go#L4300-L4310) · [社区测试助手](https://github.com/magpie-community/plugins/blob/3f2c56ddc770846494abaae1330f5d736147ec88/scripts/middleware.mjs#L16-L52)

Magpie 另有 Bun 异步 Gateway Hooks。异步请求 Hook 先于 moejs Middleware。异步响应 Hook 观察经过 Middleware 后交付给客户端的结果。订阅候选的 `onAccount` 在路由中的 `onProvider` 前执行。[请求入口](https://github.com/yetone/magpie/blob/e5c2eb9415011e668b20baca25f364bc47402d6b/internal/gateway/middleware.go#L39-L85) · [响应观察 Hook](https://github.com/yetone/magpie/blob/e5c2eb9415011e668b20baca25f364bc47402d6b/internal/gateway/gateway_hooks.go#L13-L36) · [订阅候选检查](https://github.com/yetone/magpie/blob/e5c2eb9415011e668b20baca25f364bc47402d6b/internal/gateway/gateway.go#L3978)

## 协议边界

- Anthropic 的 `tool_use.name` 出现在 SSE 的 `content_block_start.content_block`，输入可以由后续 `input_json_delta` 逐段返回。非流式工具调用在消息的 `content` 块中。流可以在 HTTP 成功后发送 `error`。[Anthropic 流式协议](https://platform.claude.com/docs/en/build-with-claude/streaming)
- 当前 Gateway 的 `onEvent` 接收已分帧的单行 JSON 对象。多行 `data:`、注释与 `[DONE]` 透传。模拟测试确认，包含工具调用名的多行帧跳过该 Hook，因而不能在此处恢复名称。真实 Factory 是否发出这类帧仍待在线验收。[Gateway SSE 分帧](https://github.com/yetone/magpie/blob/e5c2eb9415011e668b20baca25f364bc47402d6b/internal/middleware/run.go#L460-L496) · [Factory 流式测试](https://github.com/magpie-community/plugins/blob/3f2c56ddc770846494abaae1330f5d736147ec88/packages/factory/tool-names.test.mjs)
- 工具结果用 `tool_use_id` 关联上一轮的调用，并随对话历史回传。后续需要验证实际客户端是否总会带回工具声明，以及可能出现的仅有历史调用和显式工具选择的情况。上游 Factory 已有历史一致性的先例，当前证据还不能说明 Factory 在本案中如何处理历史工具名。[Anthropic 工具调用协议](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls)
- 社区 Factory 插件可从 Claude Code 的延迟工具消息中提取 `tool_definition`，并在适配时加入顶层声明。这样的定义可能在 Gateway 请求 Hook 时还未出现在 `tools`。需要先用实际客户端版本的脱敏样本确认这一形态是否出现在目标链路中。[Factory 延迟工具处理](https://github.com/magpie-community/plugins/blob/3f2c56ddc770846494abaae1330f5d736147ec88/packages/factory/index.mjs#L1840-L1920)
- 核对实际 Magpie 发行版本、Factory 插件版本、Provider/account 标识，以及 `/v1/messages/count_tokens` 在真实 Claude Code 会话中的参与方式。当前源码将 token counting 注册到单独处理器。[请求入口](https://github.com/yetone/magpie/blob/e5c2eb9415011e668b20baca25f364bc47402d6b/internal/gateway/gateway.go#L1204-L1214)
- Factory 插件可将上游 HTTP 403 的内容策略拒绝转换为下游 HTTP 400，并保留 `content_policy_rejected`。采集验收证据时区分客户端可见状态、可取得的上游状态与 SSE 中的错误事件。[Factory 错误处理](https://github.com/magpie-community/plugins/blob/3f2c56ddc770846494abaae1330f5d736147ec88/packages/factory/index.mjs#L2532-L2545)
