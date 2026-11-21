# Magpie Factory MCP 兼容性

独立的 Magpie Gateway Middleware，为经 Factory Provider 使用 Anthropic Messages 的 Claude Code 适配两个 Paseo MCP 工具名。

开发需要 Node.js 22.13+（22.x）或 24+，以及 npm。运行需要 Magpie 和已配置的 Factory Provider。

```sh
npm ci
npm run verify
```

- [产品目标与验收](docs/product.md)
- [架构与 Hook 顺序](docs/architecture.md)
- [安装到 Magpie、开发与验证](docs/development.md)
- [Agent 工作规则与文档索引](AGENTS.md)
