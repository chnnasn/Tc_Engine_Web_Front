# Return 原工程画面对照

这三张 PNG 来自用户提供的 Unity 工程实际 Play 模式，Unity 版本为 `6000.2.14f1`，Game View 设置为 1920×1080。保留原始窗口截图，包括编辑器边框；未裁切、缩放或调色。先从 Main 点击“开始游戏”，再在教学关按 Esc 打开暂停面板。截图后停止 Play，没有保存原场景。

| 画面 | 原 Unity 窗口截图 | 最终 Tc 画布截图 |
| --- | --- | --- |
| Main 菜单 | [unity-menu.png](unity-menu.png) | [tc-menu.png](tc-menu.png) |
| 教学关 | [unity-tutorial.png](unity-tutorial.png) | [tc-tutorial.png](tc-tutorial.png) |
| 暂停界面 | [unity-pause.png](unity-pause.png) | [tc-pause.png](tc-pause.png) |

Tc 截图来自最终 `b04d81d80a92fdf28ce7c27d37e24005e8a8f984` 引擎与实际发布 TCPAK 的浏览器回归，未经裁切、缩放或调色。Unity 窗口内的 Game View 有显示缩放，因此两组截图不具有相同文件尺寸。

原 `Main.unity` SHA-256 为 `be3fffdfcd42339c77a0a899907b44d5439bdbbf955f9a897078215305388890`。暂停截图 SHA-256 为 `cc616d7b84a5a7162a9aa43b9f00410f2710553853496c76ae77edabf4abdf54`；窗口坐标 `(265,305)` 与 `(1185,676)` 的背景像素均为 RGB `(135,136,141)`，同位置未暂停时为 `(29,33,45)`。浏览器回归检查对应的六个空白区域，只容许 2 个色阶的舍入差异。

截图中的巨大图标、较大的暂停按钮和叠在背景上的教学文字均存在于原版。复原以实际运行效果、源层级与资源身份共同核对，不把主观改版当作原样复现。像素颜色检查不等同于整张画面逐像素相等，也不构成性能测试。

暂停背景的资源身份已用同版本 Unity 独立探针核实。原场景引用的内置资源 GUID 为 `0000000000000000f000000000000000`，`fileID 10907` 对应 `UI/Skin/Background.psd`；先前误用的 `UI/Skin/UISprite.psd` 实际为 `fileID 10905`。两者中心 RGBA 分别为 `(214,214,214,255)` 和 `(245,245,245,255)`。原始 GPU 读回与元数据保存在样本的 [Reference/UnityBuiltins](../../samples/return/Reference/UnityBuiltins)，导入时校验 GUID、fileID 与图像哈希，保留错误映射的探针记录供对照。

正确 Background 为 32×32、四边各 10 像素、PPU200，使用 Bilinear + Clamp；原 Panel 颜色仍为 `(1,1,1,0.5686275)`。Tc 以九个原生 UIImage 表达原九宫格。网页暂停色差还需要 OpenGL 分离颜色与 alpha 混合修复，不能只替换图片或调整面板透明度。像素图的 Nearest + Clamp 与 UI 的 Bilinear + Clamp 分别按源设置保留。

本轮最终引擎锁定 `b04d81d80a92fdf28ce7c27d37e24005e8a8f984`，包括已全绿合并的上游 PR #37、#38、#39。这里的 Unity 截图是复原基准；Tc 的最终浏览器结果和实际测量另见[交付记录](../return-delivery.md)，不将此前 c284 的玩法与性能证据视为本次画面一致性证据。
