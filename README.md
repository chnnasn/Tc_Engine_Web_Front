# TomCat Web

Vue 3 创作工作台，使用固定版本的上游 TomCat Web Editor / Player。社区和示例作品仍使用本地演示数据；编辑器实际运行 C++ 引擎，项目保存到 IndexedDB，未接入云端 API。

## 开发与构建

需要 Node.js 22.18+、Python、Git、CMake 3.20+、Ninja 和 **Emscripten 4.0.15**。先激活 Emscripten SDK（Windows：`emsdk_env.bat`；Linux/macOS：`source emsdk_env.sh`），确保这些工具在 PATH 中。

```sh
npm ci
npm run engine:build
npm run dev
```

`engine.lock.json` 固定引擎提交 `0a731be0d56352d5ae5785ffaece3edd834238ab`。构建脚本会检出到 `.engine/source`、初始化四个依赖子模块，直接使用上游 `Web/CMakeLists.txt`，执行上游 RPC 和 Player Cook 回归后，再复制两个模块的 JS/WASM/DATA 到 `public/engine/<commit>/`。没有本地 C++ 移植补丁。

可通过 `TOMCAT_ENGINE_SOURCE` 指定已有的干净检出，提交必须匹配锁文件；脚本会初始化该检出的子模块。`CMAKE_BUILD_PARALLEL_LEVEL` 可调整编译并行度。

```sh
npm test
npm run build
npm run preview
# 另一个终端；测试使用已安装的 Chrome，也可设置 TEST_BROWSER_CHANNEL
npm run test:browser
```

`npm run build` 只构建网站，需先生成引擎产物。`npm run engine:build` 的真实上游回归不可由 TypeScript 单元测试代替。浏览器回归默认访问开发服务器 `http://127.0.0.1:5173`；验证 preview 时设置 `TEST_BASE_URL=http://127.0.0.1:4173`。

## 编辑器和项目

- `/editor/:id` 使用独立同源 iframe，内部启动 `TomCatEditorModule`，展示上游 Hierarchy、Inspector、Project、Scene / Game 面板。
- `tomcat.web.v1` 是唯一编辑协议。快照包含归档和组件 schema；添加对象、原生属性编辑、撤销和重做均经过引擎事务。uint64 ID 始终为十进制字符串，场景修订号为安全整数。
- 工具栏保存及原生 Ctrl/Cmd+S 保存实际场景归档、`Project.tcproj`、全部 ProjectSettings 与 Assets（包括图片和 `.tcmeta`）。只有 IndexedDB 事务完成且场景/配置/资源仍与捕获时一致，才确认 `scene.markSaved`。保存期间发生编辑时会保留未保存状态。
- 导出格式为 `tomcat-project` v2，包含引擎文档及版本；导入、复制、删除使用同一存储。不同引擎版本暂时拒绝导入，升级时需明确提供兼容策略。
- 旧 `tomcat-static-project` v1 文件仍可导入、导出和备份，但不会自动转成引擎场景。打开旧项目会说明正在使用新场景，原 localStorage 数据保留。
- 上游 Web 会话只支持内置项目挂载根，因此本版通过独立会话恢复规范化归档与资源；不是任意桌面目录导入器。场景会话 Handle 由引擎新建，实体和资产 ID 保留。

## 播放器和生命周期

作品页的播放器可选择本地 TCPAK，启动独立的 `TomCatPlayerModule`。示例作品没有实际资源包；此版本没有将当前编辑项目 Cook/公开发布的服务。编辑项目的运行预览使用原生 Play / Pause / Step / Stop。

加载前检查安全上下文、跨源隔离、SharedArrayBuffer、Worker、WebAssembly 和 WebGL2。Vue 路由退出、关闭播放器、加载失败和 WebGL 上下文丢失时，取消帧循环、断开 ResizeObserver、调用原生 shutdown、终止 pthread 池并销毁 iframe。重开创建全新模块和画布。

上游限制仍然适用：含 C# 的包不能运行，无可听 WebAudio，自定义 Cooked SPIR-V Shader 和多重采样不支持；桌面新增工具不代表浏览器已支持。

## 部署

Vite 开发/预览、Netlify 均设置：

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Netlify 的 `scripts/build-netlify.sh` 会安装锁定 SDK、构建引擎和网站；GitHub Actions 同样验证上游回归并上传包含引擎的 `dist`。自托管需提供上述响应头和正确的 WASM MIME 类型，静态资源不可被 SPA 回退替换；外部素材需满足 CORS/CORP。

引擎产物与 SDK 不提交 Git，保存在忽略目录中。更新引擎必须调整锁文件、重新构建并通过浏览器验收。
## 完整项目云端保存与恢复

编辑器点击“云端”注册或登录，创建云端项目并关联，然后“保存到云端”。项目列表的“云端项目”可恢复最新或历史修订。最新修订关联原项目，历史修订创建独立本地副本。恢复先校验每个文件的长度和 SHA-256，再写入 IndexedDB，在全新的 WASM 文件系统恢复配置及资源，最后载入活动场景归档。

保存先持久化本地草稿及旧 ETag，再逐个上传完整文件。上传成功后提交 schemaVersion 2 不可变文件清单；服务端在同一事务校验全部引用并更新修订指针。断网、上传失败、账号不符和 412 冲突均保留草稿；重新打开仍提示未保存。冲突不会自动采用新 ETag 覆盖他人修改，可恢复最新版本比较，或另建云端项目。

每个文件上限 8 MiB、项目二进制文件总量 36 MiB、最多 512 个文件；场景归档上限 4 MiB，图片导入入口目前限制 2 MiB。路径限定为 Project.tcproj、ProjectSettings/*.json 和安全的 Assets 子路径。旧本地引擎文档可以打开，再保存升级为完整文档；没有资源实体的旧云端修订不能当作完整项目恢复。当前只保留活动场景的内存编辑状态，其他 Assets 文件按引擎文件系统中的已写入内容保存。

本地启动相邻后端仓库的 API（默认端口 5080），Vite 开发和 preview 会代理 `/v1`。可用 `TOMCAT_API_PROXY` 覆盖代理目标。Netlify 构建时设置 `TOMCAT_API_ORIGIN=https://你的后端域名`，生成位于 SPA 回退之前的 `/v1/*` 代理规则；自托管同样需要同源 `/v1` 反向代理。未配置后端时仍可本地保存，云端入口会提示连接失败。后端需要持久化存储卷和正确的 AllowedHosts；不能仅部署静态网站获得云端存储。

端到端测试（需要已构建的 WASM、Chrome、相邻后端 Release 程序集）：

```powershell
# 在后端目录先运行 dotnet build TomCat.Api -c Release
node tests/cloud-browser.mjs
```

测试创建临时 SQLite、独立 API/Vite 进程及两个独立浏览器上下文，验证真实引擎跨浏览器完整恢复、配置/图片/meta 字节一致、过期 ETag、断网草稿、历史副本和损坏下载拒绝。可用 `TEST_API_DIRECTORY` 指定其他后端 TomCat.Api 路径；测试使用本地端口 5192。

顶部“我的账户”已接入真实登录、注册和账号状态；云端项目列表及修订来自 API，本地列表仍用于保存离线副本。编辑器工具栏的运行、暂停、继续、单步、停止直接调用 `preview.control`。云端保存完成前不调用 `scene.markSaved`，上传失败和 412 场景有浏览器级调用断言。

公开发布另见 [独立发布阶段](docs/publication-phase.md)：包括不可变修订输入、场景资产映射、Cook worker、产物存储、发布 API 和匿名播放器验收。该阶段尚未实现。
