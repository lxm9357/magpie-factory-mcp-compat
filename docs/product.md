# 产品目标与验收

## 已确认需求

目标是在 Factory 支持的使用方式内，使 Claude Code 通过 Magpie 调用名称符合 `mcp__<命名空间>__<工具名>` 形式的 MCP 工具。目标形态是独立的 Magpie Gateway Middleware，限定 Claude Code 的 Anthropic Messages 和 Factory Provider。项目没有前端。

最初由 `progress_show` 和 `progress_ticket_update` 复现 `content_policy_rejected` 与工具声明名称相关。后续合成声明对照在更多 Paseo 工具和另一命名空间复现名称格式相关的拒绝。真实 Factory 工具执行、多轮和官方支持范围仍待确认。[通用名称适配决定](decisions/2026-11-23-通用MCP名称适配.md)

中间件为当前请求的匹配声明分配可逆且不冲突的别名，保持工具声明的描述、输入 schema 及其他属性。对应的结构化选择、调用和引用使用同一映射，客户端收到其注册的原始工具名称。Thinking 内容和签名原样传递。其他工具与 Provider 保持各自原有行为。

使用 Magpie 公开扩展机制。Claude Code、Paseo、Magpie 核心、社区 Factory 插件及 Factory 的认证、计费、模型参数和安全策略保持原状。

## 验收标准

交付前在隔离 Magpie 中验证。用同一个 Claude Code 会话观察模拟 Provider 请求本地只读 MCP 工具、Claude Code 实际执行、返回工具结果并继续回答。保留脱敏的工具名、调用 ID、结果和消息结束证据。真实 Factory 的工具执行和多轮回传另作部署验收。

| 场景 | 通过条件 |
|---|---|
| 名称范围 | 逐项和组合验证当前可见的全部 MCP 工具名，覆盖长名称、重复、声明顺序和别名冲突 |
| 工具协议 | 验证顶层与延迟声明、显式选择和结构化历史；工具参数、正文及签名保留 |
| 隔离闭环 | 本地只读工具实际执行，下一轮关联测试结果并正常结束 |
| 流式、多轮 | 每轮正常结束，无 `event: error`，调用与结果的 ID 一致 |
| 非流式 | 客户端得到可识别的工具调用，错误响应照常可见 |
| 非 Factory Provider | 直连与路由回退两种情况下，工具名称和错误行为保持原状 |

交付需要独立审查、`npm run verify`、打包检查及上述隔离闭环记录。HTTP 200 之后出现 SSE 错误事件视为失败。

## 待办与已知问题

- Factory 官方资料已记录 Droid 原生 MCP，当前 Claude Code 链路和名称适配的官方支持情况未知。按用户确认继续原链路。[技术决策](decisions/2026-11-21-Factory支持范围与插件方案.md)
- 真实 Factory 部署仍需要插件安装权限，真实 Paseo 工具读取、测试任务更新、动态加载和后续模型续答尚待完成。[真实调用验收](development.md#真实调用验收)
