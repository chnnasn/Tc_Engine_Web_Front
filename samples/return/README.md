# Return · 归途

用户提供的 Unity Return demo 的 Tc 原生 C# 移植。入口为网站 `/games/return`；播放器运行 Tc 烘焙的 TCPAK，游戏逻辑、输入、精灵、瓦片、文字和声音均由 Tc 执行。

## 内容与操作

保留原工程的教学关 `default`、`Level1` 至 `Level5`、`final`，以及原始像素素材、跑步/待机/落地动画、按钮与门、推箱、生死世界切换和终幕选择。触碰尖刺会保留玩家位置和速度，切换世界，并在刚离开的世界留下装饰性遗骸；遗骸没有碰撞，不能用作平台。

| 操作 | 按键 |
| --- | --- |
| 开始 | Enter |
| 移动 | A / D 或左右方向键 |
| 跳跃 | Space |
| 重置当前关卡 | R |
| 暂停 / 继续 | P 或 Escape |
| 静音 / 恢复声音 | M |

使用桌面浏览器，点击游戏画面取得焦点；首次点击后浏览器才允许声音输出。离开焦点自动暂停。网页退出返回游戏菜单或使用播放器关闭按钮。

## 可编辑工程与原生 Tilemap

下载 `return-source.zip` 后，用与网站 `engine.lock.json` 对应的 Tc Editor 打开 `Return/Project.tcproj`。`Assets/Scene/return.tomcat` 是运行入口；日常编辑请打开 `Assets/Scene/Levels` 下的对应关卡。关卡使用 Tc 原生 `Tilemap2D`，保留格坐标、精灵、颜色、旋转与翻转，可在 Tc 的 Tile Palette 中逐格绘制。

下载包自带 `Tools` 与 `package.json`。安装 Node.js 后，在解压的 `Return` 目录首次执行 `npm install`；每次编辑并保存关卡后执行 `npm run sync:maps`，再在 Tc 中重新打开入口场景、编译脚本并运行或打包。同步工具会保留编辑源，将瓦片和碰撞一并更新到游戏，不需要网站源码仓库。详细步骤见 `Tools/README.md`。

当前引擎没有原生 Tilemap 碰撞组件，也没有供 C# 直接读取 Cells 的接口。本例的碰撞由固定步长 C# 模拟执行，因此编辑后需运行同步工具。未修改的图层保留 Unity 序列化的 CompositeCollider2D 轮廓，绘图层与碰撞层分别处理。

## 重建

在网站前端仓库执行 `npm run engine:return`，使用 `engine.lock.json` 锁定版本的 Tc cooker、托管程序集和源码生成器。默认路径与其他 Tc 示例相同：`.engine/player-fixture`、`.engine/upgrade-managed` 和相邻后端的 `cook/worker.mjs`，可用 `TOMCAT_PLAYER_DIR`、`TOMCAT_MANAGED_DIR`、`TOMCAT_COOK_WORKER` 指定。

`scripts/import-return.py --source E:/Gitee/Return` 用于从原 Unity 工程重新导入参考资源；重新导入会更新生成数据，不是日常编辑 Tc 关卡所必需。`Reference` 中保留源文件哈希、关卡数据、素材来源和导入报告，`ReturnLevels.cs` 为生成文件。

## 性能与适配

原生 Tilemap 的最大同时可见数量约 160 格。静态地图不会在每帧重建，运行时复用对象、缓存组件、仅提交变化的精灵/变换/文字。物理以 120 Hz 固定步长执行，单次更新限制补步次数并插值显示，避免长时间失焦后模拟突然追赶。

为了限制反复死亡的内存增长，装饰遗骸使用固定容量池；超过容量后复用最旧的遗骸。菜单与说明适配浏览器，网页退出不会关闭浏览器。性能测试只代表记录的机器、浏览器、分辨率和场景，不能保证所有设备都不掉帧。实际测量与验证记录见网站仓库 `docs/return-delivery.md`。

## 素材与许可

原仓库附带 GPL-3.0，随本工程保留完整 `LICENSE`。原图、字体、场景和音频来自用户提供的 Return 工程，来源记录在 `Reference`。`Crystaloid.wav` 由原项目的 DDRKirby(ISQ)《Gem Attack Original Soundtrack - 20 Crystaloid (Seamless)》MP3 解码，`Tutorial.wav` 由 `default.flac` 解码，均为 PCM16；音效 OGG 原样复制。

原场景的跳跃音实际绑定 `hit.ogg`（音量 0.3），死亡绑定 `stair_down.ogg`，过关绑定 `coin.ogg`，两首背景音乐音量为 0.5。原仓库未提供各第三方素材的独立授权文件，本工程保留其原始署名与来源，不额外声称素材具有独立的商业授权。
