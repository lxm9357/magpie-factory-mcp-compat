# 开发与复核

## 开发入口

需要 Git、Node.js 22.13+（22.x）或 24+，以及 npm。Magpie 运行时使用独立的 moejs，插件无需运行依赖。

| 命令 | 前置条件 | 成功判据 |
|---|---|---|
| `npm ci` | 在仓库根目录，能访问锁文件中的 npm registry | 按锁文件安装并退出 0 |
| `npm run verify` | 已执行 `npm ci` | lint、类型检查和测试均退出 0 |
| `npm run build` | 已执行 `npm ci` | npm 检查发布包内容并退出 0 |
| `git config core.hooksPath .githooks` | 在仓库根目录，本地尚未配置需要保留的 hook 路径 | `git config --get core.hooksPath` 返回 `.githooks`，后续提交前运行 `npm run verify` |

## 安装到 Magpie

需要可管理的 Magpie 实例、已启用的 JS Gateway Plugins 和现有的 Factory Provider。插件本身无环境变量或密钥。安装前记录 Magpie 和 Factory 插件版本。从仓库根目录执行：

```sh
magpie plugin add "$PWD"
magpie plugin builtin on middleware
magpie plugin list
```

列表中应显示该 middleware 已开启及其 Hook。独立工作区验证需要各自的 Magpie 数据目录和回环监听端口。使用 Linux 便携 CLI 时，可在各自 CLI 旁放置 `.portable`，并设置独立的 `DSH_HOME` 和其他相关客户端配置目录，再以 `MAGPIE_ADDR=127.0.0.1:<空闲端口> ./magpie serve` 启动。终止本次启动的进程即可停止实例。应用现有 Magpie 部署的网关地址和 Factory 登录方式由该部署管理。

## 真实调用验收

1. 让 Claude Code 连接安装了本插件的 Magpie，并选择 Factory 模型。确认它已连接 Paseo MCP。记录客户端、Magpie、Factory 插件及模型版本。
2. 按[产品验收矩阵](product.md#验收标准)分别在新会话测试只读、测试任务更新、两者同时加载。确认工具真实执行，调用和结果的 ID 一一对应，下一轮模型引用返回结果或正常结束。更新应使用专属测试任务。
3. 检查成功流的末尾有 `message_stop` 且全程无 `event: error`。有错误时保留脱敏的状态、错误类型、请求 ID 和事件序列。SSE 不能仅凭 HTTP 状态验收。
4. 用可控的 Anthropic 非流式请求检查回包工具名，并用非 Factory 路径及路由回退核对隔离。测试后禁用测试安装或停止隔离实例。

## 复核上游测试

需要 Git、网络和 Bun。调研通过 Bun 1.4.5 执行下方命令。临时目录每次单独创建，流程无需 Factory 登录状态，不使用端口、数据库或现有 Magpie 配置。命令可在任意目录运行。

```sh
(
  set -e
  research_dir=$(mktemp -d)
  trap 'rm -rf -- "$research_dir"' EXIT
  git init --quiet "$research_dir/plugins"
  git -C "$research_dir/plugins" fetch --quiet --depth=1 https://github.com/magpie-community/plugins.git 3f2c56ddc770846494abaae1330f5d736147ec88
  git -C "$research_dir/plugins" switch --detach FETCH_HEAD
  cd "$research_dir/plugins" || exit 1
  bun test packages/model-map/model-map.test.mjs packages/param-override/param-override.test.mjs packages/think-tags/think-tags.test.mjs
  bun test packages/factory/tool-names.test.mjs packages/factory/content-policy.test.mjs
)
```

检查两组均为 0 失败，分别通过 68 和 24 项。第一组覆盖社区中间件的行为样例；第二组覆盖社区 Factory 插件现有的别名逻辑和策略拒绝处理。命令结束时清理临时目录。

## 常见问题

- 工作环境有 Node、Bun 和 Claude Code CLI。`PATH` 没有 Magpie 时，可使用单独下载的 Magpie CLI。安装后通过 `magpie --version` 核对所用版本。
- 上游 Bun 样例与实际 Gateway 的上下文有差异。只在 Bun 中执行 Hook 无法核实 moejs 加载成功、实际路由回退或 SSE 帧的端到端传递。[架构](architecture.md)
- `.portable` 只隔离 Magpie 自身数据。测试网关启动时仍可能检测本机客户端，并刷新现有 DSH 路由。使用独立的 `DSH_HOME`，或在独立账号或容器中启动测试网关。

## 本次验证范围

用 Magpie v0.1.4656 Linux CLI 运行隔离网关和两种回环模拟 Provider，实际加载本插件的三个 Hook。验证两个工具分别与同时声明、SSE 和 JSON 名称恢复、第二轮 ID 对应与结束事件、非 Factory 直连及从模拟 Factory 回退、HTTP 200 带 SSE 错误事件的透传。另以固定社区 Factory 插件版本和模拟网络验证已有别名逻辑的组合，包括延迟定义和插件自带的批量别名回复恢复。

Claude Code 2.1.330 实际通过隔离网关执行两个本地 stdio MCP 模拟工具，模拟模型收到返回结果并继续对话。这个测试预先加载工具，覆盖执行与回传。动态工具定义另以构造样例验证。

当前远端的只读模型列表可见目标 Factory 模型。该入口无法安装中间件，当前环境的 Claude Code 也没有已配置的 Paseo MCP。上述验证使用模拟上游及结果，完整在线验收仍需可管理的 Factory 实例和接入 Paseo 的 Claude Code。[真实调用验收](#真实调用验收)
