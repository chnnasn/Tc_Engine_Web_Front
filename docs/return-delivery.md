# Return 复原与验证

## 可玩的交付物

- 首页精选与 `/games/return`：原生 Tc 播放器、全屏、声音和工程下载。
- `samples/return`：可编辑的 Tc 工程。运行入口 `Assets/Scene/return.tomcat`；七个关卡地图编辑源位于 `Assets/Scene/Levels`。
- `public/samples/return`：TCPAK、源码 ZIP、封面与记录引擎提交和包 SHA-256 的 `manifest.json`。
- `Reference`：原场景与素材来源、原始坐标、碰撞轮廓、导入哈希以及双世界布局对照图。

## 复原范围

从用户提供的 Unity Return 工程提取 Main 菜单、教学关、Level1–Level5 和 final。保留像素图、音乐音效、原始世界坐标、尖刺触发的生死切换、推箱、按钮与门的连接和终点切关。原工程未改动。菜单和操作说明适配网页尺寸，角色运动采用固定 120 Hz 模拟与显示插值；原 Unity 物理步长为 50 Hz。

可玩地图实际使用 27 个 Tc `Tilemap2D`，合计 770 格；未用一张关卡图片替代可编辑网格。单个世界最多约 160 格。当前 Tc 缺少原生 Tilemap 碰撞组件及托管 Cells 读取接口，因此编辑后通过同步工具生成碰撞数据；未修改的图层保留源 CompositeCollider2D 轮廓，修改图层使用导入素材的轮廓并合并相邻矩形。

## 稳定帧耗时的处理

关卡对象、组件引用、64 个装饰遗骸及 5 个音频源在启动时准备并复用。只向引擎提交发生变化的变换、精灵、文本和显隐状态；关卡切换重新启用已有实体。碰撞数组预分配，不在固定步长循环分配对象。网页隐藏与恢复重置计时，模拟限制补步次数，避免后台停留时间变成一次过大的更新。

菜单阶段收集所有界面字符（包括换行）预生成字体图集，并在零音量下预热五个音频源，停止后保留原生 voice 和 PCM 缓冲区。音量在创建音源时就设为零，避免属性延迟提交而 Play 即时执行造成短暂出声。测试同时检查实际输出静音、开始游玩后的正常音量和缓冲区复用。

下落箱子会对玩家进行向下扫掠检查，避免穿透并持续重叠；玩家移开后箱子继续下落。这是轴向运动模型，不模拟原 Unity 动态刚体的质量、冲量和完整箱子堆叠反馈。

用户指出的转向后角色倒立，已定位为负缩放经矩阵分解后遗留额外旋转。示例改用正尺寸和绕 Y 轴半周旋转实现水平镜像；上下翻转对应绕 X 轴旋转。原图与烘焙纹理无需翻转。验证读取实际 GPU 顶点和 UV，区分纹理上传与变换方向，覆盖左右转向后重开。

图片保留原 Gamma 像素值，关闭无用 mipmap；这同时修正当前渲染路径将源像素明显变暗的问题。Tc 现有采样器仍采用线性过滤，不声明已实现 nearest 采样。

## 上游

[PR #32](https://github.com/chnnasn/TomCat_Engine/pull/32) 修复辅助 C# 源文件参与编译后被原生 cooker 拒绝的问题：脚本源码列表可以包含不挂载到实体的辅助类型，同时保留句柄、路径和可挂载行为校验。已合并为 `5ea02a054739f313d75596eab8258391650e8b97`，Windows 与 browser-wasm CI 通过。[后端 PR #1](https://github.com/chnnasn/Tc_Engine_Web_backend/pull/1) 为旧 cooker 生成仅包含行为的挂载列表，完整源文件仍参与编译与哈希；已合并为 `6b90dcce4e9854afdb13b376fc425357cd6496ff`，13 项测试与真实 Return 烘焙通过。

[PR #31](https://github.com/chnnasn/TomCat_Engine/pull/31) 处理脚本投影、批量实体创建/销毁和后处理开销；[PR #33](https://github.com/chnnasn/TomCat_Engine/pull/33) 将命令批次提取改为线性处理，复用名称索引，并减少 Web 渲染清屏时的同步状态读取。两项均已合并。实际接入版本以最终引擎锁文件及下方验收记录为准。

[PR #34](https://github.com/chnnasn/TomCat_Engine/pull/34) 修复带符号缩放的 Transform 属性写入、父子层级同步、脚本命令队列内读回与物理回写。显式属性保留作者指定的旋转和缩放符号；通用矩阵分解入口仍保留原有校验。旧引擎 `5734c56a` 使用隔离测试副本的原始负缩放写法，在“左转再右转”处可稳定重现倒立；生产工程和包在此对照试验中保持不变。

[PR #35](https://github.com/chnnasn/TomCat_Engine/pull/35) 修正新增回归对安全回滚返回值的断言：拒绝非法变换的批次可成功完成回滚，须检查 Abort/Commit 计数和场景未变。最终合并提交 `9a0ccad79bb4ec33225bd8210fe9b47438bb06bc` 的 [Windows](https://github.com/chnnasn/TomCat_Engine/actions/runs/38942251843) 与 [browser-wasm](https://github.com/chnnasn/TomCat_Engine/actions/runs/38942251932) 完整 CI 均通过。

## 验证方法

`npm test` 校验首页入口、TCPAK 每项哈希、资源句柄、源工程 ZIP、全关卡地图和宿主计时恢复。`node scripts/return-tilemap.test.mjs` 在临时项目中实际绘制一个格子，验证保存后构建不会覆盖编辑、碰撞会同步改变，擦除后恢复原始数据。`node tests/return-physics.mjs` 编译真实 C# 物理代码，检查平台、墙壁、推箱等规则以及 100,000 次模拟的分配情况。

`tests/return-browser.mjs` 使用发布包和普通键盘操作检查开始、跳跃、真实尖刺切换、重开、暂停、静音、全屏、音频输出和退出清理。`tests/return-levels-browser.mjs` 使用单独复制并烘焙的 QA 工程，检查七个关卡的两个世界；关卡选择和只读诊断键只存在于该副本。教学关推箱压按钮、开启机关和到达终点使用普通游戏输入完成。发布工程不含这些诊断键。

`tests/return-editor-browser.mjs` 下载实际 ZIP，恢复到隔离编辑器会话，验证原生 Tilemap schema、单格删除、撤销、重做、保存、场景重新打开及完整页面重载。测试使用隔离 API fixture，不向用户云端写入项目。此次发现并修复的大资源 Base64 正则调用栈溢出也有 4 MiB 文件回归。

启用 `TEST_RETURN_NATIVE_INSPECTOR=1` 时，还会实际点击原生 Inspector 的 Cells 行删除按钮并执行原生撤销，核对场景格子数。此项覆盖 Inspector 逐格编辑，不把它表述为 Tile Palette 画笔自动化测试。

`tests/return-homepage-browser.mjs` 验证首页精选入口、详情页、实际源码 ZIP 下载、封面加载及 390 像素宽度下无横向溢出。

`tests/return-orientation-browser.mjs` 对实际上传的角色纹理及 GPU 顶点/UV 取证，覆盖连续左右转向、同朝向位置更新、跳跃、死亡切换和重开，共 20 次画面捕获，检查角色始终正立。首页封面也来自修正后实际运行的第三关。

浏览器证据同时保存页面获取的包哈希、实际 Service Worker 缓存的引擎 JS/WASM 哈希、浏览器/GPU/画布尺寸、原生日志、音频状态和截图。CPU 回调耗时与浏览器 rAF 间隔分开统计，不能把 rAF 频率当成显示器实际呈现帧数，也不能据此保证所有设备零掉帧。

## 发布版本与首次加载优化证据

- 引擎：`9a0ccad79bb4ec33225bd8210fe9b47438bb06bc`，Managed API v6 / TCPAK v8 / Scene v11 / Project v4。
- Return：129 个包条目、15,191,027 字节；SHA-256 `5f147302510cbaf21cc8cf9db766c22a411cff38ab670aa5d7528b7749a771dc`。
- [引擎发布资产](https://github.com/chnnasn/Tc_Engine_Web_Front/releases/tag/web-engine-9a0ccad7)：压缩包 SHA-256 `37a3be824ae8996d665164f320225439c3fbfdedad78c6e306bf2f2fdddb3cbd`，内部 manifest hash `0bdfaa69d00cbbedefd79e06de8378545593bb3f74f880099ddc1ee1d0d1875a`。
- 54 项前端单元测试、13 项实际 C# 物理场景、100,000 次固定步长零分配检查、27 层 / 770 格 Tilemap 编辑同步与前端构建均通过。

首次进关对照使用同一引擎 `a751ab69`、Chrome 155.0.8059.82、Intel UHD Graphics / ANGLE D3D11、1440 × 1000 浏览器窗口。未挂 CPU 分析器的预热前最大 CPU 回调为 48.96 ms，预热后为 15.25 ms；预热后的完整普通输入检查共 7,866 帧，最大 17.685 ms，没有超过 33 ms 的 CPU 帧。该轮包含真实教学关通关、跳跃、尖刺切换、暂停、静音、全屏、重开与关闭；20 次人物方向检查另外执行。

独立 CPU 采样将原始尖峰定位到字体图集的 SHA 校验/构建，以及音频加载和 WebAudio voice 创建；预热后的首次进入采样未再观察到这些调用。采样器本身增加耗时，因此采样中的 65–97 ms 不作为普通帧耗时对照。音频检查记录五次零增益预热、六次实际输出静音采样，完整玩法的 16 次播放后 PCM 缓冲区仍为五个。

上述结果是具体测试条件下的 CPU 时间，不能保证任意设备零掉帧；其他系统进程和驱动造成的偶发抖动尚不能排除。最终引擎与该对照版本的生产源码相同，差异为 PR #35 的测试断言修正；最终版本仍单独执行关卡与旧工程兼容验收。

## 最终引擎验收

最终生产 TCPAK 的普通输入测试记录 7,739 帧，CPU p95 为 4.895–7.09 ms，首次进关最大 10.235 ms，整轮最大 17.57 ms，无超过 33 ms 的 CPU 帧。实际菜单静音、五个 PCM 缓冲区复用、教学关自然通关、暂停/静音/全屏/重开、退出和缓存热重开均通过；人物方向另测 20/20 通过。

`9a0ccad7` 的全关卡检查覆盖 7 个关卡 × 2 个世界、28 个 idle/movement 阶段，记录 28,887 帧、约 225 秒。各阶段 CPU p95 为 4.485–7.805 ms。共 3 帧超过 16.667 ms，其中 2 帧超过 33.333 ms、1 帧超过 50 ms；三帧集中在终章生世界的一小段移动中，最大 64.52 ms。没有从这组时间值推断未经采样证实的原因。WASM heap 始终为 128 MiB，无运行时异常。

同轮浏览器、GPU 与前述实测相同；root 未并发运行构建或另一套 GPU 测试，其他系统任务未被完全隔离。rAF p95 为 5.665–11.265 ms，表示回调节奏，不表示显示器实际帧率。全关卡 QA 副本 SHA-256 为 `2126d0c98018029da47954aff1be69f06902c147c4c0b4606fb7f9fae468594f`，与生产包明确区分。教学关通过普通按键自然完成；其他关卡使用 QA 导航选择，未声称全游戏自然通关。

真实旧引擎 `5734c56a` 和 `0b8829a8` 分别创建项目、保存到隔离云端 fixture、清除本地项目，再由最终引擎恢复并保存，场景字段和 uint64 标识保持一致。身份旋转的序列化由 `-0` 变为数值等价的 `0`，所以兼容检查使用精确 YAML 类型值比较。`0b8829a8` 编译的 CoinRunner 与现有 `5734c56a` Rougelike 发布包也在最终播放器正常运行、输出声音并完成清理。

逐阶段统计、资源哈希和原始证据摘要见 [return-validation.json](return-validation.json)。
