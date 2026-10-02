# 引擎升级验收（2026-10-02）

前端引擎与 Railway Docker 打包器统一固定到 `1223a9610066d420485fa7f273b0eeca34835bbf`（产品 0.5.0、TCPAK v8、Managed API v5）。旧项目兼容列表加入 `5ab4174b`，保留 `684eb8f` 与 `0a731be0`；云端写入继续要求当前引擎重新 capture。

本次纳入字体缓存轮询修复、共享 C# Inspector 改进与运行时场景加载修复。自定义服务器编译器仍沿用现有载荷发现路径和编译配置，没有改用 Windows CLI。此前内置字体的 Docker/worker 修复保留。

## 验证

- 完整原生编译、WASM 链接及 .NET browser-wasm 发布成功，产物约 48.9 MiB。
- 前端 27 项测试通过；后端 26 项通过，Redis 测试因未配置服务跳过。
- 登录权限浏览器回归通过。
- 真实浏览器引擎回归通过：C# 编译/生命周期、归档保存、撤销重做、uint64、预览、保存冲突、游戏包播放、高 DPI 与会话清理。
- 真实 API + WASM 云端往返通过：图片/meta/配置字节、旧 ETag、离线草稿、历史修订恢复与损坏下载拒绝。
- Node/WASM worker 编译并打包实际挂载基础 C# 脚本的项目成功。
- 服务器生成的基础 C# TCPAK v8 在托管浏览器播放器启动成功；网站生产构建通过。

详细本地输出：`.engine/upgrade-1223-*.log`。

## 部署与限制

引擎目录为 `public/engine/1223a9610066d420485fa7f273b0eeca34835bbf/`；产物压缩包为 `.engine/tomcat-web-1223a961.tar.gz`。这些产物被 Git 忽略，Git 推送不会上传它们。Netlify Git 构建需提供对应的 `ENGINE_ARTIFACT_URL`，先上线新前端，再更新 Railway。

未部署线上；本机无 Docker/WSL Linux，Linux 镜像构建未验证。浏览器多帧文字稳定性未做专项像素验收，仅确认相关上游修复纳入构建且常规浏览器回归通过。

上次记录的 CoinRunner SaveData Mono 桥接及 JSON 反射禁用问题没有相关上游修复，本次未重测、不视为已支持。原生 DLL、持久存档、完整非 Windows ICU/IME 与可听音频边界继续保留。
