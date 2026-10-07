# Web 场景工具与桌面实现对齐

引擎提交：`053fcce44c36ef94c4bd4a3750da7eb4e75d0303`。旧实现只共享 Hierarchy、Inspector 等面板，WebEditorUI 自己绘制 Scene，遗漏了桌面视图中的辅助显示及编辑入口。

## 这次复用的桌面能力

- `EditorViewportHandles` 改为接收宿主场景、摄像机、选择与历史回调；桌面和 Web 编译同一份几何、拾取、碰撞体及 RectTransform 编辑实现。
- 摄像机图标与点选、近远裁剪面、透视 FOV / 正交范围、选中颜色；范围使用 Game 视口比例。
- Canvas 平面及 UI 边界、RectTransform 平移/旋转/缩放、父级变换与布局约束。
- Box / Circle Collider 轮廓、Edit Collider 手柄、拖拽历史事务。
- 双击 Hierarchy / F 聚焦，2 键切换 2D/3D，同一份场景方向控件。
- Pivot / Center、Local / World、Ctrl 吸附、图片资源拖入 Scene。
- 接通 Animation、Animator、Tile Palette、Profiler 和 Asset Inspector 窗口；工作区保存包含新增窗口。
- 资源选择使用桌面 Inspector；不再每帧清空多选及资源选中状态。补接复制、剪切、粘贴、F2 重命名快捷键。
- 修复 WebGL 混合颜色/整型附件的清屏报错，以及快速点选使用上一帧鼠标位置的问题。

## 浏览器边界

原生文件选择器、外部 IDE、桌面 Player 构建/安装、原生模块加载和独立操作系统窗口不照搬。Web 继续通过网页入口导入、导出、编辑 C#、云端保存与发布。

这不是整个桌面编辑器所有功能的等价性证明：Project 面板内的完整文件管理、Prefab 创建/覆盖工作流等仍受现有 Web 宿主接入限制；本次没有通过简单打开开关来声称它们已经可用。

## 兼容性

用户确认保留现有项目。仅将 `41708b6c756d530a1c71f0e0ef2539a1df1bb03e` 列入兼容集合，其他旧格式仍拒绝。前端本地、云端读取、云端保存、作品播放与后端完整清单校验一致。打包器保持上一版，格式与 ABI 不变。

`tests/viewport-upgrade-browser.mjs` 使用真正的上一版 WASM 创建并保存项目，移除本地项目副本，新版从云端恢复，断言实体、归档不变，再保存为新版。

## 已运行的验证

- Windows MSVC 编译桌面编辑器 C++ 文件通过。
- Emscripten C++、独立 Player 和 .NET browser-wasm 编译通过。
- `tests/viewport-browser.mjs`：摄像机快速点选与可视范围变化，碰撞体 / UI 手柄拖拽与单步撤销，F 聚焦、2D/3D、五个编辑窗口渲染，无 WebGL 错误。
- `tests/viewport-upgrade-browser.mjs`：真实旧引擎项目云端恢复、内容保留与新版本保存。
- `tests/browser.mjs`：C# 编译与执行、归档、撤销、预览、样例 Player、高 DPI。
- `tests/cloud-browser.mjs`：真实 API + WASM 完整资源往返、过期 ETag、离线草稿、历史恢复与损坏下载拒绝；同步更新了旧版账户和项目列表选择器。
- 前端 28 项测试、类型检查与生产构建通过；后端 API / 发布测试 15 项通过，包括保留原历史修订的新版本保存。

截图保存在本地 `.engine/viewport-*.png`，测试只写隔离夹具项目。

## 发布产物

- 引擎源码已推送至上游 `main`。
- GitHub Release：`web-engine-053fcce4`，文件 `tomcat-web-053fcce4.tar.gz`，19,677,757 字节。
- SHA-256：`7b832c7a89a2d633873ab203e130f7db78865082a37e3eb37ae98eb5c237ab55`，与 GitHub 资产摘要一致。
- 后端兼容更新 `aa3382f`；Railway 部署 `dab4aeaf-8eaf-4c38-99b4-5fd701468905` 为 SUCCESS，公开 `/health` 返回 `status: ok`。
