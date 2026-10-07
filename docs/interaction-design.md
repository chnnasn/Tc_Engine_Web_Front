# 首页与 AI 助手交互

参考：https://claude.com/ （2026-10-07）。参考其首屏操作层级、展开导航和渐进呈现信息的方式，保留 TC Fun 的品牌、作品和实际功能。

- 首页：游玩 / 创作选项卡，方向键、Home / End 切换；示例切换同步更新实际入口；三步创作演示明确标记“交互预览”，不触发模型调用；FAQ 原生折叠。
- 导航：固定顶部，创作入口展开；外部点击、Escape、焦点离开与导航后关闭；手机使用折叠菜单。Escape 返回相应触发按钮。
- 编辑器：右侧 AI 面板，手机纵向排列；提示按钮只填入输入框，不自动执行；Ctrl / Command + Enter 提交，普通 Enter 换行，输入法组合中不提交。
- 执行：当前请求与回复分区展示；工具记录可展开；检查点与错误分别呈现。收起面板使用 `v-show` 保留任务，停止按钮取消任务，离开编辑器仍清理会话。
- 当前后端每次任务独立，不提供对话历史上下文。本次界面不添加虚假的模型切换、附件上传或历史会话入口。
- 支持 `prefers-reduced-motion`，手机布局验证覆盖 360 / 390 / 768 像素。

验证命令：

```sh
npm run build
npm test
node tests/interaction-browser.mjs
node tests/agent-browser.mjs
```

浏览器测试截图写入 `docs/interaction-preview/`（忽略入库）。首页测试使用只读 API 桩；AI 测试使用真实本地 .NET、MCP、浏览器与 WASM，加确定性的模型 fixture，覆盖执行、收起继续执行、检查点保存及失败。
