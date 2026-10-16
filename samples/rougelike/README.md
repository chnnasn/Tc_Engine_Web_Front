# Rougelike · Tc 引擎示例

这是用户提供的 Godot `Rougelike` 小 Demo 的 Tc 原生 C# 复原工程。主页播放器加载 Tc 烘焙的 `rougelike.tcpak`，由 Tc 的 `MonoBehaviour`、输入、相机、精灵、文字和音频系统执行游戏；没有把 Godot 运行时嵌入网页，也没有用网页 Canvas 重写游戏逻辑。

## 运行入口

- **网页试玩**：打开网站的 `/games/rougelike`，点击“开始游玩”，再点击游戏画面取得输入焦点。菜单里可以走近“开始游戏”挥刀，或按 Enter。
- **本地 Tc 工程**：解压 `rougelike-source.zip`，用与网站 `engine.lock.json` 匹配的 Tc Editor 打开 `Rougelike/Project.tcproj`，打开 `Assets/Scene/rougelike.tomcat` 后运行。`ProjectSettings/BuildSettings.json` 也将这张场景设为构建入口。
- **原始参考工程**：用户提供的 `Rougelike/project.godot` 声明 Godot 4.7；其项目运行入口为 `Scenes/Menu.tscn`，战斗场景为 `Scenes/main.tscn`。它用于核对行为，不是本示例的运行依赖。

源码 ZIP 用于**本地 Tc 原生工程**，不能直接作为网站云端导入包。为保留原音频，工程内 `Assets/Audio/Welcome.wav` 保留了原始 10,495,844 字节（约 10.01 MiB），超过网站单个文件 8 MiB 限制。本示例没有修改云端限制；已经烘焙的网页游戏包通过静态资源加载，不受云端上传入口影响。

## 操作

| 输入 | 作用 |
| --- | --- |
| W / A / S / D | 移动，菜单和终幕中也可移动 |
| 鼠标 | 瞄准；角色平滑转向 |
| 左键 / 右键 | 朝前挥刀 / 朝后挥刀，每次按下攻击一次 |
| 走近控件并挥刀 | 打碎菜单按钮、强化卡或“覆写”来选择；标题和 HUD 也能被打碎并恢复 |
| Shift（解锁后） | 按住减缓世界时间，持续耗能；玩家行动维持原速 |
| R（解锁后） | 在鼠标处放置吸引敌人的黑洞 |
| 长按左键后松开（解锁后） | 蓄力并发射飞刃；按下时仍有一次普通攻击 |
| Enter | 菜单开始；死亡或通关后重试 |
| 1 / 2 / 3 | 强化阶段选择对应卡片 |
| E | 强化阶段覆写，整局共三次 |
| P | 战斗或强化阶段暂停/继续；战斗失焦自动暂停，返回后按 P 继续 |
| M | 死亡或通关后回菜单 |

技能不是开局自带，需要抽取对应特殊强化。能量不足时无法挥刀或放黑洞；时停耗尽后需松开 Shift 才能再次启动。浏览器中的“退出游戏”显示离开提示，使用页面返回或关闭播放器按钮离开。

## 复原范围与网页适配

保留原作的米白/深灰几何风格、1152×648 参考场地、十波数量/血量表、初始属性、能量与无敌时间、随机稀有度和全部 21 项强化。菜单与三选一卡片共享战斗命中方式；前后斩交替挥动，按当前已经扫过的环带多边形判定命中，并跟随玩家移动/转向。敌人追击、归一化分离、接触伤害、Combo、三种特殊技能及强化期技能使用均由 C# 运行。

六张原始几何精灵、`monogram.ttf`、`Silver.ttf`、`Welcome.wav` 和五个原音效均直接复制，未重新采样或替换。原音效为挥刀、命中、致命命中、受伤、黑洞；原作未引用的 `kill-sfx.wav` 不进入游戏。音频使用 Tc `AudioSource → AudioEngine → WebAudioDevice` 链路，浏览器需先有用户点击才能开始播放；不使用额外的 HTML 音频播放器。验证状态见 [REFERENCE.md](REFERENCE.md)。

原生渲染器重建了斜切卡片、蓝色能量尾条、可分别打碎的标题/HUD、半圆与半六边形碎片、刀光、黑洞多边环、飞刃拖影和死亡时间轴。以下效果存在明确近似：

- 斜卡和刀光视觉使用原生精灵条带；刀光碰撞仍使用当前 3–6 段环带多边形。半圆和半六边形碎片直接使用原图左右半区的 Tc 图集子资源，与原作的两片裁切精灵对应；两半共用原形状中心作为旋转原点。
- 文字碎裂按字符分成两部分，没有逐像素裁切字形。
- CRT 使用原生 `Camera.Vignette` 和 216 条扫描线；受伤红晕、死亡故障条带和淡黑重建了观感与时序，未移植 Godot 屏幕采样着色器的曲率、色差和真实图像撕裂。
- 保留十波胜利后的重试页、局内统计、键盘快捷选择、暂停与操作说明，属于网页适配。原作第十波仅显示 `CLEAR`，没有独立胜利菜单。

实际生产包已完成菜单走位挥刀开始、首波 5 击杀清场、三张强化卡显示、数字 1 选择进入第二波、接触死亡后回菜单重开，以及非零音频、全屏与关闭清理的浏览器验证。主页封面采用第二轮真实原生全屏三卡截图。三技能另有预置状态的原生 QA 验证；这些结果不等同于挥刀选卡、死亡音高数值或自然通关十波均已验证。完整原参数、源文件证据、数值边界与对应源版本见 [REFERENCE.md](REFERENCE.md)。

## 重新构建

在前端仓库执行：

```powershell
npm run engine:rougelike
```

已生成的 `.tcpak` 可直接在网页玩家中运行，不需要访客安装编译器。修改工程后重新烘焙需要 .NET SDK 10，以及与 `engine.lock.json` 对应的 Tc 工具链：

| 环境变量 | 默认位置 / 用途 |
| --- | --- |
| `TOMCAT_COOK_WORKER` | 同工作区后端的 `Tc_Engine_Web_backend/cook/worker.mjs` |
| `TOMCAT_PLAYER_DIR` | `.engine/player-fixture`；包含 `tomcat_player.js/.wasm/.data`、声明 CommonJS 的 `package.json` 和 Tc 的 `Packages/fonts` |
| `TOMCAT_MANAGED_DIR` | `.engine/upgrade-managed`；包含同版本 `TomCat.Managed.dll` 与 `TomCat.ScriptGenerator.dll` |
| `TOMCAT_DOTNET` | 可选的 `dotnet` 可执行文件路径 |

后端 `cook/local-build-player.mjs` 用于构建原生 Cooker。在引擎 `Managed` 目录构建相应项目，并将 `bin/Release/net10.0` 的两份 DLL 放入 `TOMCAT_MANAGED_DIR`。工具链已就绪时，仅修改游戏 C# 不需要重新构建整个 Web 引擎。

构建脚本生成场景，通过 Tc 的 C# 源生成器编译脚本，调用 `tc_web_player_cook`，并验证 TCPAK 各条目的 SHA-256、资源句柄及托管程序集。输出：

- `public/samples/rougelike/rougelike.tcpak`
- `public/samples/rougelike/manifest.json`
- `public/samples/rougelike/rougelike-source.zip`（不含 Library 等缓存）

`node scripts/build-rougelike.mjs --scene-only` 只重新生成可编辑的 `.tomcat` 场景。`.tcmeta` 和构建脚本记录稳定资源句柄；禁用且位于屏幕外的场景资源锚点确保运行时引用的精灵、字体、音频进入烘焙包。

## 验证入口

前端仓库中运行 `node tests/rougelike-logic.mjs` 可验证实际游戏源里的波次、全部解锁状态抽卡池、概率边界、稀有度插值、全部 21 个强化应用分支、7 个数值钳制边界、覆写延迟与快捷选卡的竞态防护和近战多边形判定，需要 .NET 10 与 `TOMCAT_MANAGED_DIR`。该检查直接调用生产纯逻辑方法，不启动渲染器，不代表浏览器已通关十波。

开发服务器启动后，`node tests/rougelike-browser.mjs` 运行浏览器验收；`TEST_BASE_URL` 可指定网站地址。可选环境变量 `TEST_COMBAT=1` 和 `TEST_REQUIRE_AUDIO=1` 分别开启首波战斗、实际音频输出检查。每次验收应按实际通过的分支记录覆盖范围，不能把首波通过等同于全部随机技能和十波通关。

`node tests/rougelike-skills-browser.mjs` 单独验证三技能和第十波压力，默认连接 `http://127.0.0.1:5185`。它将生产工程复制到忽略提交的 `.engine/rougelike-skills-*`，仅在副本 `Awake` 末尾设置第十波、三技能已解锁与 100 生命，再用相同 Tc 工具链烘焙；Playwright 只替换该测试页面的包请求，生产工程及公开下载包保持原样。断言依据是原生日志、真实 WebAudio 节点的音高/音效、画布像素、暂停与关闭行为，输出 `fixture.json`、`evidence.json` 和截图。`--build-only` 只烘焙；`--fixture=<目录绝对路径>` 可在源码和工具链哈希相同时复用。该预置状态不证明自然流程已解锁技能或通关十波，压力阶段也不以墙钟时间冒充全部 60 个敌人已出生。

性能验收另用 `tests/rougelike-performance-browser.mjs` 连续空挥八次，以及 `tests/rougelike-stress-browser.mjs` 聚敌、施放技能并连续攻击。两者默认使用 Chrome 硬件 GPU，记录实际引擎回调耗时与调度间隔；软件渲染只应显式用于对照，不能混入硬件性能结果。压力脚本使用独立的 1000 生命 QA 副本，默认聚敌 120 秒，生产包不包含该初始化。`TEST_STRESS_FULLSCREEN=1`、`TEST_STRESS_WIDTH=1920`、`TEST_STRESS_HEIGHT=1080` 可指定全屏压力场景；`TEST_STRESS_MAX_FRAME_MS` / `TEST_STRESS_P95_MS` 与空挥脚本对应的 `TEST_PERF_*` 可设置本机验收门槛。具体基线、限制与结果见仓库中的 `docs/rougelike-performance.md`。

## Tc 实现要点

- `Assets/Scripts/RougelikeGame.cs` 是挂到场景的 `MonoBehaviour`。规则和音频辅助类型保留在同一个脚本文件内，避免桌面导入器给纯辅助 `.cs` 分配独立脚本资产后产生元数据不匹配。
- 正交相机参考高度 648，位置 Z=-10，朝 Tc 的局部 +Z 方向看；原作画布坐标通过 `(x - 576, 324 - y)` 转为 Tc 的 Y 轴向上坐标。各视觉元素的深度为 `-Order × 0.005`，避免原生深度测试挡住后画的填条和叠加效果；文字另外下移一行高，将原生文本行框底部转换成示例使用的顶部坐标。不同浏览器画幅通过相机适配，战斗边界保持参考场地。
- `World.CreateEntity` 和增加组件通过延迟命令提交；回调内的隔离投影允许读取已排队的新实体及组件，`Flush` 据此取得组件代理并更新图形。静态图形的变换、颜色、可见性和文字采用变化缓存，减少跨托管边界的重复更新。
- 图形由 `SpriteRenderer`、`TextRenderer` 与 `Camera` 渲染，原字体通过 `AssetRef<FontAsset>` 引用。音频为非流式资源，BGM 循环并随时停/死亡调整音高，音效保持原作单通道覆盖策略。
