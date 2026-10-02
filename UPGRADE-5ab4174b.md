# 引擎升级验收（2026-10-01）

前端与后端 Docker 打包器统一为 `5ab4174b787af390fe6bb45bf1d12fe3099304d1`，Managed API v5、TCPAK v8。保留 `684eb8f` 与 `0a731be0` 项目读取兼容性，云端写入仍要求当前引擎重新 capture。

## 已验证

- 完整原生编译、WASM 链接及 .NET browser-wasm 发布成功，产物 48.9 MiB。
- 前端 27 项单元测试、网站生产构建、登录权限浏览器回归通过。
- 后端 26 项测试通过，Redis 测试因未配置服务跳过。
- 真实浏览器：C# 编译和生命周期执行、场景保存、撤销重做、uint64、预览、保存冲突、游戏包播放、高 DPI 和生命周期清理通过。
- 真实 API + WASM：图片/meta/配置字节往返、旧 ETag 拒绝、离线草稿、历史修订恢复、损坏下载拒绝通过。
- 新服务器 Node/WASM worker 成功打包无脚本及挂载基础 C# 脚本的项目；C# TCPAK v8 在托管浏览器播放器中启动成功。
- CoinRunner 的三脚本编译和 Cook 通过。首次 Cook 暴露缺少内置字体，已通过 Docker 携带 OpenSans 并由 worker 挂载到 MEMFS 修复。

## 限制

CoinRunner 浏览器运行触发新 SaveData 的 Mono 桥接错误及 `JsonSerializerIsReflectionDisabled`，不能视为可用的浏览器样例。原生 DLL 模块、浏览器持久存档、完整非 Windows ICU/IME 与可听音频未在本次升级中提供。

本机没有 Docker 或 WSL Linux，尚未验证 Linux 镜像构建，也未部署到 Netlify/Railway。

## 产物与部署

引擎目录：`public/engine/5ab4174b787af390fe6bb45bf1d12fe3099304d1/`。
压缩包：`.engine/tomcat-web-5ab4174b.tar.gz`（约 19.6 MB）。目录与压缩包均被 Git 忽略，推送代码不会上传它们。

Netlify Git 构建需将压缩包上传到可访问的产物地址，并设置 `ENGINE_ARTIFACT_URL`；构建脚本将下载到对应提交目录。先发布新前端播放器，再发布 Railway 新打包器；避免旧前端读取新 v8 包。历史引擎目录保留在本地，Netlify 构建脚本只将锁定版本放入最终发布目录。

本地详细输出保留于 `.engine/upgrade-*.log`，真实打包测试使用的项目与 TCPAK 同样位于 `.engine/`。
