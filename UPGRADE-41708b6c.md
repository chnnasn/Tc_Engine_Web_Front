# 引擎与 Skills 升级验收（2026-10-07）

前端引擎、后端 Docker 打包器及完整项目写入校验统一为 `41708b6c756d530a1c71f0e0ef2539a1df1bb03e`（产品版本 0.6.0）。Skills 依赖及 uv 锁文件升级到 `18edbfe28b81da28cc931507ac2b766d5ce6fbc0`。只接受当前提交，不增加旧项目兼容。

本次上游主要新增 Windows 原生编辑器自动化、隔离的测试输入及工作流回归。Project v4、Scene v11、TCPAK v8、Managed API v5 和 Web RPC 协议保持一致。原生自动化服务不会因升级而出现在浏览器或 Railway 上。

## Web MCP 适配

上游工具由 18 个增加到 72 个。将原先排除三个工具的筛选改为明确列出 15 个已经实现的共享工具，加上 Web 专用同步查询，共 16 个。上游后续增加工具不会自动公开。缺少必需的上游 schema 时启动失败，避免提供不完整的服务。

测试对照前端 `supportedTools` 校验 MCP 目录，并验证全部未映射的上游工具在请求到达后端前被拒绝。Agent 指令明确排除新增的桌面 Save As。浏览器端到端测试的注册步骤同步到现有邮箱验证流程，测试邮箱仅写入临时目录。

## 验证结果

- 原生库、独立 Web Player 和最终 .NET browser-wasm 构建通过，托管引擎产物约 49.0 MiB。
- 前端 27 项测试通过；后端非 Redis 测试 33 项通过；MCP 7 项通过。Redis 已补测：独立运行 8 项通过（含父测试及 7 个子测试），0 失败、0 跳过。
- 网站 TypeScript 检查及生产构建通过。
- 真实浏览器：C# 编译与生命周期、归档持久化、清理、uint64、撤销重做、预览、保存冲突、游戏包播放和高 DPI 通过。
- 真实 API + WASM：完整项目与资源字节往返、过期 ETag、离线草稿、历史恢复及损坏下载拒绝通过。
- LangChain 测试模型 → HTTP MCP → 认证后端会话 → 浏览器 → WASM：schema、创建、读取、撤销和验证通过。未调用外部付费模型。
- 新编译的 Node/WASM worker 成功编译 C# 项目并生成 TCPAK v8，产物在托管浏览器播放器中启动通过。测试配置与 Docker 一致的 CommonJS 标记和内置字体目录。

日志位于 `.engine/upgrade-417-*.log`。本机测试不等于 Linux Docker 镜像验证；Railway 镜像构建仍需部署环境或 Linux CI 验证。此前 SaveData 浏览器限制不在本次验证范围内。

## Redis 补充验收（2026-10-07）

使用 [Redis Windows 8.2.10 MSYS2 便携构建](https://github.com/redis-windows/redis-windows/releases/tag/8.2.10)，压缩包 SHA-256 为 `281f180eaba420f43eb18d655197d55bf804eb692bc55209264bfb284da3850f`，与发布资产摘要一致。工具保存在 Git 忽略的 `.engine/tools/redis-8.2.10/`，没有安装系统服务。测试仅连接本机临时 Redis、SQLite 和测试账号。

- 后端：工作快照读取、权限和资源校验、ETag 并发冲突、Redis/API 重启后的 AOF 恢复、定期落库、提交后清理重试、手动及 AI 检查点立即落库、Redis 故障返回 503、删除清理均通过。
- 实时同步浏览器：自动同步、定期落库确认、资源复用、手动保存、离线草稿、恢复重试、旧 ETag 写入拒绝均通过。测试注册步骤更新为邮箱验证。
- Redis 模式的 AI 浏览器：LangChain 测试模型经 MCP、后端和 WASM 完成编辑/撤销，验证开始与结束检查点以及结束检查点保存失败提示。
- 日志：`.engine/redis-integration.log`、`.engine/redis-realtime-browser.log`、`.engine/redis-agent-browser.log`。

本机复跑（PowerShell，依次执行）：

```powershell
$env:TEST_REDIS_SERVER = 'E:\Github\Tc_Engine_Web\Tc_Engine_Web_Front\.engine\tools\redis-8.2.10\Redis-8.2.10-Windows-x64-msys2\redis-server.exe'
Set-Location E:\Github\Tc_Engine_Web\Tc_Engine_Web_backend
dotnet build TomCat.Api -c Release
node --test tests/redis.test.mjs
Set-Location E:\Github\Tc_Engine_Web\Tc_Engine_Web_Front
node tests/realtime-browser.mjs
node tests/agent-browser.mjs
```

测试使用 `appendfsync always`；没有模拟物理断电，也未验证生产 `everysec` 的数据丢失窗口。Windows 构建上的通过不替代 Railway Linux 环境验收。

## 部署产物与边界

- 引擎目录：`public/engine/41708b6c756d530a1c71f0e0ef2539a1df1bb03e/`。
- 压缩包：`.engine/tomcat-web-41708b6c.tar.gz`（19,586,785 字节）。
- 压缩包被 Git 忽略，需单独上传并更新 Netlify 的 `ENGINE_ARTIFACT_URL`。
- 前后端严格检查当前提交，应协调上线；混用版本会拒绝完整项目保存或游戏包加载。MCP 服务需按新锁文件安装依赖并重启。

本轮完成代码、构建与本地验收，未提交、推送或部署线上。
