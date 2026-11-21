# 产品目标与验收

## 已确认需求

目标是在 Factory 支持的使用方式内，使 Claude Code 通过 Magpie 调用 Paseo 的 `progress_show` 和 `progress_ticket_update`。目标形态是独立的 Magpie Gateway Middleware，限定 Claude Code 的 Anthropic Messages 和 Factory Provider。项目没有前端。

按需求提供方的重放记录，首次请求能正常完成，动态加载这两个 MCP 工具中的任一个后出现 `content_policy_rejected`。仅改变工具声明名称的对照请求能以 HTTP 200 和无错误事件的 SSE 正常结束。该观察定位到名称相关差异，真实工具执行、多轮和 Factory 官方支持范围仍待确认。

范围限于用户给定的两个固定名称，保持工具声明的描述、输入 schema 及其他属性，客户端收到其注册的原始工具名称。历史工具调用、显式工具选择和返回结构以协议及验证结果为准。Thinking 内容和签名原样传递。其他工具与 Provider 保持各自原有行为。

使用 Magpie 公开扩展机制。Claude Code、Paseo、Magpie 核心、社区 Factory 插件及 Factory 的认证、计费、模型参数和安全策略保持原状。

## 验收标准

在可控的 Magpie 测试环境中，用同一个 Claude Code 会话观察模型请求工具、Claude Code 真正执行、工具结果返回模型、模型继续回答。保留脱敏的工具名、调用 ID、测试任务结果、消息结束与错误事件证据。

| 场景 | 通过条件 |
|---|---|
| 单独加载 `progress_show` | Paseo 返回实际只读结果，模型基于结果继续 |
| 单独加载 `progress_ticket_update` | 测试任务出现预期变化，工具结果返回后模型继续 |
| 同时加载两个工具 | 两个工具在同一会话分别实际执行，结果正确关联 |
| 流式、多轮 | 每轮正常结束，无 `event: error`，调用与结果的 ID 一致 |
| 非流式 | 客户端得到可识别的工具调用，错误响应照常可见 |
| 非 Factory Provider | 直连与路由回退两种情况下，工具名称和错误行为保持原状 |

初始化需要可安装的最小骨架、统一验证、构建或打包及上述实际闭环记录。HTTP 200 之后出现 SSE 错误事件视为失败。

## 待办与已知问题

- Factory 官方资料已记录 Droid 原生 MCP，当前 Claude Code 链路和名称适配的官方支持情况未知。按用户确认继续原链路。[技术决策](decisions/2026-11-21-Factory支持范围与插件方案.md)
- 隔离 Magpie 已验证模拟双工具、多轮和 Provider 回退。真实 Factory 部署仍需要插件安装权限，真实 Paseo 工具读取、测试任务更新、动态加载和后续模型续答尚待完成。[验证记录](development.md#本次验证范围)
