# TomCat Web

## AI 编辑助手

编辑器工具栏新增“AI 助手”。登录并打开云端项目后即可输入需求。前端通过同源 `/v1/editor-sessions` 长轮询接收工具命令，将 15 个共享 TomCat Skills 工具映射到真实 WASM 事务与预览接口，并提供 `project_get_sync_status` 查询当前内容的同步/落库状态。

任务开始前和正常结束后自动建立完整项目检查点，立即保存为不可变修订；Redis 模式下同样立即落库。开始检查点失败时不启动 Agent；结束保存失败明确提示，已执行的修改保留。AI 面板显示检查点修订 ID，云端历史版本下拉框标注“AI 开始/结束”和任务编号，历史版本在打开时关联新的云端项目。取消、失败、页面关闭不保证有结束检查点，不自动回滚；同步状态查询和任务检查点都复用 ETag 冲突保护。

AI 面板通过 `POST /agent-runs` 提交任务，收到 202 后每秒查询结果；模型长请求只在后端与 MCP 之间进行。编辑器命令继续使用最长 20 秒的长轮询，适配 Netlify 代理限制。任务并非持久队列，后端重启或编辑器离线后需要重新检查场景再执行。

需要启动相邻 `Tc_Engine_Web_Mcp` 的 LangChain 服务，并配置后端 `Agent__Url` / `Agent__Secret`。关闭面板、退出页面或停止任务会关闭会话；已执行的编辑保留。首版每条需求独立执行，不包含持久聊天、脚本生成、自动构建发布。`node tests/agent-browser.mjs` 使用确定性模型测试真实 LangChain → MCP → 后端 → 浏览器 WASM 的创建、验证、撤销闭环。

Vue 3 创作工作台，使用固定版本的上游 TomCat Web Editor / Player。社区和示例作品仍使用本地演示数据；编辑器实际运行 C++ 引擎，项目强制关联云端账号，IndexedDB 作为缓存，支持云端保存与可选的 Redis 自动同步。

## 开发与构建

当前浏览器引擎锁定 `053fcce4`，复用桌面端 Scene 辅助显示与编辑手柄。此次仅更新编辑器与 WebGL 清屏，TCPAK v8、Scene v11、Project v4、Managed API v5 不变，因此明确兼容上一版 `41708b6c` 项目和游戏包；更旧及未知提交仍拒绝。Railway 打包器保持 `41708b6c`，后端同时接受这两个已验证的提交，现有项目重开后保存为新版，无需删除重建。详见 [场景视图对齐记录](docs/desktop-scene-parity.md)。

该版本恢复了完整托管 Web 构建，并引入分帧场景加载、文字塑形、虚拟列表、2D 光照与后处理等引擎功能。原生 DLL 模块仍不支持 Web；浏览器存档持久化、完整 ICU/IME 和可听音频不因版本升级而自动获得支持。

本地升级验收发现 CoinRunner 的新 SaveData API 会触发 Mono WASM 桥接错误，JSON 存档也出现 `JsonSerializerIsReflectionDisabled`，因此该样例不能作为已支持的浏览器作品发布。常规 C# 编译与生命周期回归独立验证。服务器打包镜像额外提供内置 OpenSans 字体，以支持文字场景 Cook。

需要 Node.js 22.18+、Git、CMake 3.20+、Ninja，以及 **.NET 10 SDK + `wasm-tools` 工作负载**：

```sh
dotnet workload install wasm-tools
```

Emscripten 默认取自 `wasm-tools` 自带的工作负载 pack，无需单独安装；若要使用独立 emsdk，设置 `EMSDK`（可选 `EMSDK_PYTHON`）即可。`TOMCAT_ENGINE_SOURCE` 可指向已有的干净检出（提交必须与锁文件一致）；`CMAKE_BUILD_PARALLEL_LEVEL` 调整编译并行度。

```sh
npm ci
npm run engine:build
npm run dev
```

`engine.lock.json` 固定引擎提交 `41708b6c756d530a1c71f0e0ef2539a1df1bb03e`，并记录 `kind: managed`。构建脚本检出到 `.engine/source`、初始化四个依赖子模块，然后用 **托管（C#）管线** 生成引擎产物：先用 Emscripten 编出 C++ 静态库（`tomcat_managed_web_entrypoints`、`tc_player_core`、`tc_yaml`、`box2d`），再 `dotnet publish -r browser-wasm` 发布 `Managed/TomCat.WebHost`——**最终 `.wasm` 由 .NET 运行时拥有**，C++ 引擎归档被链接进同一块 WebAssembly 内存，原生与托管共享函数表。最后把完整的 `main.js`、`_framework/` 与 C# 编译引用集 `refs/` 复制到 `public/engine/<commit>/`。没有本地 C++ 移植补丁。

托管模块是单线程构建（`WasmEnableThreads=false`），产物中不含 `SharedArrayBuffer`/pthread，因此**不再要求跨源隔离**；`vite.config.ts` 与 `netlify.toml` 仍保留 COOP/COEP 以便将来启用线程构建。

```sh
npm test
npm run build
npm run preview
# 另一个终端；测试使用已安装的 Chrome，也可设置 TEST_BROWSER_CHANNEL
npm run test:browser
```

`npm run build` 只构建网站，需先生成引擎产物。浏览器回归默认访问开发服务器 `http://127.0.0.1:5173`；验证 preview 时设置 `TEST_BASE_URL=http://127.0.0.1:4173`。

托管产物体积明显大于旧的纯 Emscripten 产物（含 .NET 运行时、Roslyn 与烘焙进模块文件系统的预加载资源），首次进入编辑器/播放器需要下载 `_framework/`。

## 访问权限

游客可以浏览大厅、游玩作品和阅读论坛。编辑器、项目工作台、收藏页、新建/导入/复制项目、收藏、发帖、留言和回复均需要登录。启动时先验证 `/v1/auth/me`；受保护页面在验证结束前不会挂载编辑器。退出、401、窗口重新激活及定时检查会更新登录态；评论等写操作在提交时重新校验会话。

新建、导入和复制会先创建云端项目。编辑器及 iframe host 在启动引擎前验证登录态和云端项目归属，不提供解除关联后的本地编辑模式。项目和收藏缓存按账号隔离，旧的无账号缓存不会自动划给当前用户。社区内容仍为本地演示数据，本次仅增加登录门禁。

`npm run test:auth` 在开发服务器上验证匿名访问、登录返回、云端归属、会话失效与账号隔离，使用模拟 API；真实云端往返由 `tests/cloud-browser.mjs` 验证。

## 编辑器和项目

- `/editor/:id` 使用独立同源 iframe，内部加载托管 Web 引擎（`globalThis.TomCatWeb`），展示上游 Hierarchy、Inspector、Project、Scene / Game 面板。
- `tomcat.web.v1` 是唯一编辑协议。快照包含归档和组件 schema；添加对象、原生属性编辑、撤销和重做均经过引擎事务。uint64 ID 始终为十进制字符串，场景修订号为安全整数。
- 工具栏保存及原生 Ctrl/Cmd+S 保存实际场景归档、`Project.tcproj`、全部 ProjectSettings 与 Assets（包括图片和 `.tcmeta`）。只有云端保存及 IndexedDB 事务完成且场景/配置/资源仍与捕获时一致，才确认 `scene.markSaved`。保存期间发生编辑时会保留未保存状态。
- 导出格式为 `tomcat-project` v2，包含引擎文档及版本；导入、复制、删除使用同一存储。仅接受当前锁定引擎版本；旧项目不再自动迁移。
- 旧 `tomcat-static-project` v1 文件仍可导入、导出和备份，但不会自动转成引擎场景。打开旧项目会说明正在使用新场景，原 localStorage 数据保留。
- 上游 Web 会话只支持内置项目挂载根，因此本版通过独立会话恢复规范化归档与资源；不是任意桌面目录导入器。场景会话 Handle 由引擎新建，实体和资产 ID 保留。

## 发布与玩家作品

编辑器工具栏新增“发布”：发布使用最近一次云端保存的修订，`PublishDialog` 展示打包进度并轮询状态（pending → published/failed），支持更新发布与取消发布（需确认）。未保存的编辑不会包含在发布内容中，对话框会提示先保存。

发布成功后作品出现在 `/play`（玩家作品页，游客可访问）：列表来自 `GET /v1/games/published`，支持搜索与刷新；`/play/{id}` 下载公开游戏包（上限 256 MiB）并在独立播放器中运行，复用 `EngineSurface` 的 player 模式。页面比对发布时记录的 `engineCommit` 与本地引擎锁定版本，旧版本给出“可能无法运行”的警告。导航栏新增“玩家作品”入口；该路由不在登录门禁内，游客可直接游玩。社区与示例作品仍为本地演示数据；需要后端配置 `Cook:CliPath` 打包工具后才能真正发布（见后端 README“作品发布与打包”）。

`tests/arcade.test.mjs` 验证公开 API 模块的引擎版本兼容判断。

## C# 脚本

编辑器工具栏的“C# 脚本”面板支持在浏览器内新建、导入、编辑、删除 `Assets/Scripts/**/*.cs`，并用 Roslyn 编译后直接安装到当前会话：

- 每个脚本写入时同步生成 schema v2 `.tcmeta`（`Type: CSharpScript` + 稳定 `Handle`），Handle 与编译清单 `ScriptAssets.json` 一致。
- “编译并安装”调用 `globalThis.TomCatWeb.compileAndInstall({ sources, references, scriptAssetsJson })`；诊断来自 Roslyn 与 TomCat 源生成器，逐条显示 `severity/code/message/file:line:column`。
- **挂载**：引擎把 `CSharpScripts` 注册为 `AddableInInspector = false`，`component.add` / `component.patch` 都无法添加，因此面板通过把组件记录注入场景归档再走 `scene.loadArchive` 来挂载（与上游 `Web/tests/managed-browser-smoke.html` 同一路径）。`src/engine/scene-archive.ts` 负责行级注入，注入结果仍由引擎 `Decode` 校验，格式错误会以 `INVALID_SCENE` 拒绝而不是写坏场景。挂载记为可撤销的 “Import scene” 事务。
- 点击“运行预览”时会先自动编译安装含 C# 的场景所需程序集；编译失败或未安装会被引擎以 `SCRIPT_COMPILE_FAILED` / `SCRIPT_ASSEMBLY_REQUIRED` 明确拒绝，不会静默降级。
- **脚本 Handle 必须精确传递**：Handle 是 uint64，源生成器用 `GetUInt64()` 解析，而 JS 的 `Number` 在 2^53 以上会丢精度，导致引擎报 `Missing C# script asset …the attachment was skipped`。因此 `scriptAssetsJson()` 手工拼接 JSON 保留十进制原文，绝不经过 `Number`。
- **重新编译需要重建会话**：原生 `WebEditorSession::SetManagedAssembly` 每个模块只接受一代程序集，浏览器 WebAssembly 没有可回收 ALC。脚本改动后面板会提示“重建引擎会话”，点击后宿主先抓取完整项目、重新挂载 iframe，新模块启动时恢复场景再重新编译安装。因此不要期待原地热重载。
- 脚本文件、`.tcmeta` 与依赖图片都随项目一起保存到云端；前端 `assertDocument` 与后端 `ProjectFiles.TryManifest` 都会校验 `.cs` 必须成对出现 `.tcmeta`。

## 播放器和生命周期

作品页的播放器可选择本地 TCPAK，启动独立的托管播放器会话。示例作品没有实际资源包；此版本没有将当前编辑项目 Cook/公开发布的服务。编辑项目的运行预览使用原生 Play / Pause / Step / Stop。

加载前检查安全上下文、WebAssembly 和 WebGL2（托管构建是单线程，不再要求跨源隔离或 `SharedArrayBuffer`）。Vue 路由退出、关闭播放器、加载失败和 WebGL 上下文丢失时，取消帧循环、断开 ResizeObserver、调用原生 shutdown、终止可能存在的 pthread 池并销毁 iframe。重开创建全新模块和画布。

上游限制仍然适用：无可听 WebAudio，自定义 Cooked SPIR-V Shader 和多重采样不支持；桌面新增工具不代表浏览器已支持。**含 C# 的 TCPAK 现在可以播放**（这是本次升级的主要目标），但包内脚本必须是已编译进 `Assembly-CSharp` 的类型；浏览器不提供反射式脚本发现。

## 部署

Vite 开发/预览、Netlify 均设置：

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

托管构建是单线程的，上述响应头不是运行前提，仅为将来启用线程构建保留。自托管需提供正确的 WASM MIME 类型（`.wasm` → `application/wasm`），静态资源不可被 SPA 回退替换；外部素材需满足 CORS/CORP。

`scripts/build-netlify.sh` 负责发布构建。托管引擎产物需要 .NET 10 SDK + `wasm-tools` + CMake + Ninja，明显重于旧的纯 Emscripten 构建，因此脚本按以下顺序处理：

1. 若 `public/engine/<commit>/manifest.json` 已存在，直接复用（本地或 CI 预构建产物）；
2. 否则若设置了 `ENGINE_ARTIFACT_URL`，下载并解包预构建的引擎压缩包到 `public/engine/<commit>/`；
3. 否则在具备完整工具链的机器上运行 `npm run engine:build`。

Netlify 的默认构建镜像不保证具备上述工具链，推荐**预先构建引擎产物**（本地构建后提交，或用 CI 产物/对象存储），让 Netlify 只执行 `npm run build`。`netlify.toml` 的 `NODE_VERSION` 需为 22。

引擎产物与 SDK 不提交 Git，保存在忽略目录中。更新引擎必须调整锁文件、重新构建并通过浏览器验收。
## 完整项目云端保存与恢复

先登录，再新建或打开云端项目，编辑器中点击“保存到云端”。项目列表的“云端项目”可恢复最新或历史修订。最新修订关联原项目，历史修订在进入编辑器时创建新的云端项目。恢复先校验每个文件的长度和 SHA-256，再写入 IndexedDB，在全新的 WASM 文件系统恢复配置及资源，最后载入活动场景归档。

保存先持久化本地草稿及旧 ETag，再逐个上传完整文件。上传成功后提交 schemaVersion 2 不可变文件清单；服务端在同一事务校验全部引用并更新修订指针。断网、上传失败、账号不符和 412 冲突均保留草稿；重新打开仍提示未保存。冲突不会自动采用新 ETag 覆盖他人修改，可恢复最新版本比较，或另建云端项目。

每个文件上限 8 MiB、项目二进制文件总量 36 MiB、最多 512 个文件；场景归档上限 4 MiB，图片导入入口目前限制 2 MiB，单个 C# 脚本限制 512 KiB。路径限定为 Project.tcproj、ProjectSettings/*.json 和安全的 Assets 子路径；图片（`.png/.jpg/.jpeg/.tga`）与 C# 脚本（`.cs`）都必须成对提供 `.tcmeta`，前后端校验一致。旧本地引擎文档可以打开，再保存升级为完整文档；没有资源实体的旧云端修订不能当作完整项目恢复。当前只保留活动场景的内存编辑状态，其他 Assets 文件按引擎文件系统中的已写入内容保存。

本地启动相邻后端仓库的 API（默认端口 5080），Vite 开发和 preview 会代理 `/v1`。可用 `TOMCAT_API_PROXY` 覆盖代理目标。Netlify 的 `netlify.toml` 显式配置 `/v1/*` 和健康检查代理，修改其中的 Railway 目标地址即可。生产环境还需在 Netlify 的 Runtime 范围配置 `TOMCAT_PROXY_SECRET`，与后端 `Proxy__Secret` 相同，用于签名代理请求；自托管同样需要同源 `/v1` 反向代理。未配置后端时无法使用编辑器，游客仍可浏览公开页面与游玩作品。后端需要持久化存储卷和正确的 AllowedHosts；不能仅部署静态网站获得云端存储。

端到端测试（需要已构建的 WASM、Chrome、相邻后端 Release 程序集）：

```powershell
# 在后端目录先运行 dotnet build TomCat.Api -c Release
node tests/cloud-browser.mjs
```

测试创建临时 SQLite、独立 API/Vite 进程及两个独立浏览器上下文，验证真实引擎跨浏览器完整恢复、配置/图片/meta 字节一致、过期 ETag、断网草稿、历史副本和损坏下载拒绝。可用 `TEST_API_DIRECTORY` 指定其他后端 TomCat.Api 路径；测试使用本地端口 5192。

顶部“我的账户”已接入真实登录、注册和账号状态；云端项目列表及修订来自 API，本地列表仍用于保存离线副本。编辑器工具栏的运行、暂停、继续、单步、停止直接调用 `preview.control`。云端保存完成前不调用 `scene.markSaved`，上传失败和 412 场景有浏览器级调用断言。

公开发布另见 [独立发布阶段](docs/publication-phase.md)：包括不可变修订输入、场景资产映射、Cook worker、产物存储、发布 API 和匿名播放器验收。该阶段尚未实现。

## 自动同步

后端配置 Redis 后，已关联云端的项目在编辑模式下每轮同步完成约 2 秒后再次检查完整快照；内容未变不重复上传，已上传资源按 SHA-256 复用。场景归档目前仍为完整快照，尚非对象级增量协议。后端每 30 秒生成数据库历史版本；手动保存或 Ctrl/Cmd+S 立即落库。

页脚显示同步状态。仅在后端确认落库且当前内容仍与快照一致时清除未保存标记。断网时保留 IndexedDB 草稿并自动重试；版本冲突会停止上传、保留原凭据，后续编辑继续保存为本地草稿。恢复“最新修订”会优先获取 Redis 中尚未落库的状态，指定历史版本仍从数据库恢复。

后端未配置 Redis 时保留手动保存行为。启用方式及单实例限制见相邻后端 README。完整 WASM 自动同步验收：

```powershell
$env:TEST_REDIS_SERVER = '你的 redis-server 可执行文件绝对路径'
node tests/realtime-browser.mjs
```

需先构建后端 Release 和前端引擎资源，并安装 Chrome。测试启动临时 Redis（16389 端口）、API 和 Vite（5193 端口），覆盖自动同步、落库确认、资源复用、手动保存、断网重试和过期写入。

## 邮箱账号

注册流程：邮箱和密码 → 邮件验证码 → 自动完成注册。账号只使用经过验证的邮箱登录；界面与用户资料 API 不再提供用户名，旧用户名登录及绑定入口已移除。已有已验证邮箱的账号继续使用原邮箱和密码，项目归属不变。

后端需要配置 SMTP 才能在线发送验证码，参见后端 README 的“邮箱注册与旧账号绑定”。未配置时页面会显示邮件服务不可用，不会跳过邮箱验证。

浏览器回归：启动 `npm run dev` 后运行 `node tests/email-auth-browser.mjs`（邮箱注册/登录、验证码错误、密码显示与桌面/手机布局），以及 `npm run test:auth`（既有权限与账号隔离）。前者模拟 API 响应；后端邮件验证链由后端 HTTP 集成测试覆盖。

账号弹窗现提供“忘记密码”和“修改密码”。找回需使用已验证的注册邮箱；修改需输入当前密码。改密后所有设备需重新登录，项目归属保持不变。浏览器回归 `tests/email-auth-browser.mjs` 同时覆盖这两个流程、确认密码不一致和当前密码错误提示。
