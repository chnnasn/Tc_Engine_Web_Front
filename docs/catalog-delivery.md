# 首页示例与发布验证

> 下列章节记录首页整理及旧链接删除时的历史版本。Shelter 随后已依据原 Unity 场景和运行截图修正地图、建筑比例与交互，并升级到 `c28487215bd5df89b35c1d68252ba240231d9c4f` 引擎；以下旧引擎、截图和测试数字不代表当前交付。当前构建、性能边界与发布核验状态见 [Shelter 最新交付记录](shelter-delivery.md) 和 [原工程复原说明](shelter-restoration.md)。本次部署 `6ad3637c85e10d28709df848` 已发布；线上资源、旧路由 404、29 项交互及首次成功风暴后的继续流程均通过。

2026-10-17。首页保留 Return、Shelter、Rougelike，并将三个重复的刚体演示合并为 Physics Lab · 物理实验室。用户明确要求删除旧链接后，移除 `forest`、`desert`、`puzzle` 的跳转与客户端兼容逻辑；旧网址返回 404，不跳往物理实验室。

精选区域桌面端每 6 秒自动切换，悬停、键盘聚焦、页面隐藏、区域离开视口时暂停。提供手动切换和暂停按钮；手机和减少动态效果模式不自动轮播。首页只加载截图，不启动隐藏游戏实例。

截图均来自实际 Tc WASM 运行：Return 关卡、Shelter 风暴、Rougelike 强化界面和 Physics Lab 下落刚体。Physics Lab 通过同一 native 场景格式保留原四个刚体和静态地面，不再以虚构冒险故事介绍。

## 本地验证

- `npm test`：58/58 通过。兼容旧封面的用户本地工程和场景，不因更新宣传图片而丢失数据。
- `npm run build`：通过；既有 Monaco 编辑器大分块提示仍存在。
- `tests/catalog-browser.mjs`：四个实际截图与入口、6 秒轮播、悬停暂停、手动暂停/切换、减少动态效果和 390 px 手机布局通过。证据 `.engine/catalog-qa/2026-10-17T10-42-41-313Z/`。
- `tests/auth-browser.mjs`：新物理示例的游客试玩、登录边界和账号隔离通过。
- `tests/physics-capture.mjs`：实际 native 物理画面随时间变化，无运行时异常。
- Return 用当前源文件和锁定工具链重新 cook，修复发布前发现的 ZIP 与源文件不同步。`tests/return-browser.mjs` 的实际输入、跳跃、生死切换、重开、静音、全屏和退出通过，证据 `.engine/return-qa/2026-10-17T10-43-54-278Z-9676/`。本次短功能回归与构建同时运行，不作为新的性能基准。
- `tests/return-homepage-browser.mjs`：最终生产构建的首页、入口、真实图片、源码 ZIP 下载与手机布局通过。
- Shelter 完整性能记录见 [Shelter 交付](shelter-delivery.md)，本次未再改游戏循环或引擎版本。

## 发布流程与线上检查

构建后执行 `node scripts/compress-engine.mjs`，为锁定引擎生成 190 项校验资源的 gzip 传输及响应头。只保留 `dist/engine/5734c56ae05241b01a684afb8e62f2b164c69ba2`，移除构建输出中的 27 个历史引擎副本。

通过已关联的 Netlify 项目 `tcengineweb` 发布到 https://www.tcfun.fun ，部署 ID `6ad351e545a44a54c191985e`。部署记录在 `.engine/catalog-qa/deploy.json`。这是从本地已验证构建直接部署，不代表工作区所有改动已经提交或推送到 GitHub。

首次发布的线上验收全部通过（当时包含 301，后续已按用户要求移除）：

- `tests/catalog-deploy.mjs`：14 项包、源码 ZIP 和图片逐字节 SHA-256 一致；三个旧路由均为 301；190 项引擎资源均具备压缩传输路径；后端 `/health` 返回 200 / ok。证据 `.engine/catalog-qa/deploy-resources.json`。
- `tests/catalog-player-browser.mjs`：使用真实后端和首次安装的远端引擎，Return、Shelter、Rougelike、Physics Lab 均实际启动、响应普通输入、正常停止且 iframe 被释放；缺包错误提示通过；无未捕获异常或 native 脚本故障。证据 `.engine/catalog-qa/player-2026-10-17T10-46-56-410Z/evidence.json`。
- `tests/catalog-browser.mjs`：正式网站四个截图和入口、自动轮播及各暂停行为、减少动态效果、手机布局全部通过。证据 `.engine/catalog-qa/2026-10-17T10-47-20-951Z/evidence.json`。

## 删除旧链接

后续部署 `6ad353af88ea5f2b226b8389` 已移除三个旧网址的跳转和客户端别名。生产构建及本地浏览器验证通过；正式站点 `/games/forest`、`/games/desert`、`/games/puzzle` 均返回 HTTP 404，且没有 Location 响应头。`/games/physics-lab` 返回 200 并加载新客户端。证据 `.engine/catalog-qa/remove-old-links-evidence.json`，部署记录 `.engine/catalog-qa/remove-old-links-deploy.json`。
