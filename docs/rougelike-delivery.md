# Rougelike 交付简报

记录日期：2026-10-16。用户提供的 Godot Demo 已重建为 Tc 原生 C# 示例，并接入主页首屏、精选卡片与详情页。

**已发布，并通过正式域名验收。** 入口为 [Rougelike · 几何竞技场](https://www.tcfun.fun/games/rougelike)，[主页](https://www.tcfun.fun) 已将其放在首屏和精选示例位置。可直接下载 [Tc 原生工程 ZIP](https://www.tcfun.fun/samples/rougelike/rougelike-source.zip)。

## 交付内容

- 游戏通过 Tc 的 `MonoBehaviour`、输入、相机、`SpriteRenderer`、`TextRenderer` 和 `AudioSource` 运行，交付可播放的 TCPAK 与可编辑的 Tc 工程 ZIP。
- 重建十波敌人数与生命表、前后斩、走位与接触伤害、能量、Combo、三选一强化、21 项强化、整局三次覆写、时停、黑洞、蓄力斩，以及死亡和重开流程。菜单、强化卡与可破坏 HUD 共用近战命中方式。
- 保留六张原始几何精灵、`monogram.ttf`、`Silver.ttf`、`Welcome.wav` 与五个原音效。音乐和音效经 Tc 原生音频链路播放，保留独立 BGM、单通道音效覆盖及慢时变调。
- 网页增加键盘快捷选择、暂停、全屏、操作说明、加载失败重试与退出清理。封面来自实际 Tc 游戏画面。

原生精灵条带重建了斜卡和刀光，半圆/半六边形碎片使用原图左右半区的 Tc 图集子资源；CRT 扫描线、暗角、受伤红晕和死亡故障保留观感与时序，但没有复原 Godot 屏幕采样着色器的曲率、色差和真实图像撕裂，文字碎裂也不是逐像素裁切。

完整资源、数值与差异依据见 [复原核对](../samples/rougelike/REFERENCE.md)；操作、工程打开方式和重建条件见 [示例 README](../samples/rougelike/README.md)。源码 ZIP 用于本地 Tc 工程：保留的原始 BGM 超过网站单文件 8 MiB 云端上传限制，不能把该 ZIP 宣称为可直接云端导入包。

## 上游修复与全局工具链

引擎修复已通过 [上游 PR #30](https://github.com/chnnasn/TomCat_Engine/pull/30) 合并，正式提交为 [`5734c56ae05241b01a684afb8e62f2b164c69ba2`](https://github.com/chnnasn/TomCat_Engine/commit/5734c56ae05241b01a684afb8e62f2b164c69ba2)。它补齐了：

1. WebAudio 驻留音频输出、用户操作解锁、播放控制和上下文释放；共享音高范围扩至 0.01–4，支持原作慢时与死亡变调。流式音频仍明确不支持。
2. 发布后动态编译脚本所需的 BCL 实现与类型转发信息，修复 `MathF.Sqrt` 等调用被裁剪的问题。
3. 浏览器单线程字体队列的调度死锁：先发布已准备图集，再准备下一套字体，保留原内存限制。

候选 `e1a430e549c002241c0480d704180fc0300c6ade` 与正式合并提交的 Git 文件树一致。上游 Windows 回归和 browser-wasm CI 均已通过；浏览器回归包含动态 BCL、两套真实字体的画面像素、真实 AudioSource 非零信号和关闭清理，以及各 PCM 格式和音频控制检查。

浏览器引擎、后端 Cooker、托管 API 和源生成器已统一固定并部署到正式提交，详见 [engine.lock.json](../engine.lock.json) 与 [仓库 README](../README.md)。继续使用 Managed API v6、TCPAK v8、Scene v11 和 Project v4。上一版 `0b8829a864ff53ad0ad2c7ded56ef433325a836a` 经真实旧作品播放及云端归档恢复回归后进入明确兼容列表；这不是对未知提交或旧 Managed API v5 的通用放行。

## 已完成的验证与边界

| 验证层次 | 已通过的实际范围 | 不能据此声称 |
| --- | --- | --- |
| 生产游戏浏览器流程 | 原生菜单挥刀启动；鼠标近战完成首波 5 次击杀；显示三选一卡并选取强化；进入第二波；真实接触伤害死亡；M 返回菜单、Enter 重开；WebAudio 非零输出；全屏尺寸与关闭后 AudioContext 释放 | 已自然通关全部十波，或已在自然随机流程中解锁所有技能 |
| 技能浏览器副本 | 复制生产工程，仅预置三技能解锁、第十波与 100 生命，再经相同原生 Cooker 构建。验证 Shift 慢时及 BGM 音高恢复、R 黑洞、蓄力释放、生命/能量填条像素、38 秒敌群压力、P 暂停画面稳定和音频关闭 | 预置第十波不等于自然打到第十波；墙钟压力时间不等于 60 个敌人全部出生，更不等于通关 |
| 生产方法逻辑回归 | 直接调用实际游戏脚本方法，覆盖十波表、8 种解锁组合、概率边界、稀有度插值、21 个强化应用分支、7 个重复钳制边界、描述及近战多边形判定 | 纯逻辑通过不等于渲染、输入或所有随机组合实玩通过 |
| 覆写竞态回归 | 有效选卡取消待执行覆写；旧覆写不能从五种非强化状态重新发牌；无卡和次数耗尽时拒绝动作。测试调用生产选择守卫与动作分发方法 | 此项方法回归不能自动替代修改后的全流程浏览器复测 |

可复跑入口为 [主流程浏览器检查](../tests/rougelike-browser.mjs)、[技能浏览器检查](../tests/rougelike-skills-browser.mjs) 和 [生产逻辑检查](../tests/rougelike-logic.mjs)。主流程通过 `TEST_MENU_SLASH`、`TEST_COMBAT`、`TEST_DEATH`、`TEST_REQUIRE_AUDIO` 显式开启相应覆盖，不能用默认启动检查替代这些分支。

技能浏览器结果对应生产脚本 SHA-256 `4fd2ee42d8d0c906d5568edda0da222f2c420c435be288cad9efead3d591f994`。后续 `d9b5c24cbea48c147f0df0c959c59b90d68b15c0af862d64161c2a9599b75d5a` 仅修复覆写竞态，并通过上述生产方法回归；2026-10-16 23:20（北京时间）已使用正式引擎与最终包再次通过完整主流程浏览器检查，包括菜单挥刀、首波、选卡、第二波、死亡、返回菜单、重开、实际音频、全屏和关闭清理。该轮 TCPAK SHA-256 为 `dab80522e621a167ce4d28192fc25d0e8edc8b15d05ed1cd920f5983b38f1ea5`，17,193,584 字节，17 个条目。所有 HUD 分组的打碎/恢复、自然十波通关和完整随机技能组合仍未逐项验收。

最终前端构建通过类型检查及 49 项测试。后端构建为零警告/零错误，38 项测试通过、1 项 Redis 环境测试跳过；Redis 配置未修改。正式版本再次通过上一版 TCPAK 播放与云端工程归档恢复检查。可复用引擎产物发布于 [web-engine-5734c56a](https://github.com/chnnasn/Tc_Engine_Web_Front/releases/tag/web-engine-5734c56a)，归档 SHA-256 为 `e9a3de28da09c2dfc5a6b24f01c5719429760b2dd17cd8ee694d68322cc5b2c7`。

## 生产发布与验收

- 前端应用提交：[`909d1fd`](https://github.com/chnnasn/Tc_Engine_Web_Front/commit/909d1fd65e08e784336868c0e0629485e8450271)。Netlify 正式部署为 `6ad24384d7acd1d9a490161b`；发布前预览部署为 `6ad24092196311780527fc29`，两次使用相同应用产物。
- 后端提交：[`48413a3`](https://github.com/chnnasn/Tc_Engine_Web_backend/commit/48413a3)。Railway 生产部署 `78e98bf6-aab8-4a4f-a1d1-f7b8691a017c` 成功，构建日志确认检出正式引擎提交；直连和网站代理 `/health` 均返回 `200`、`{"status":"ok"}`。Redis、MCP 与数据卷设置未修改。
- 2026-10-16 23:36（北京时间），正式域名的匿名浏览器检查通过：真实包启动与首波、WebAudio 非零输出、全屏尺寸、关闭 iframe 与音频上下文、再次打开时无需下载引擎压缩资源。此次使用真实后端，没有替换 API 响应；未登录接口的 `401` 为预期行为。
- 正式域名的引擎清单包含 190 个资源，提交为 `5734c56a`。游戏包、源码 ZIP、封面逐字节哈希均与本地发布文件相同。ZIP SHA-256：`3a42335260c7501d49ddd081afccd19cff4631e13c5531064c0925b016009be4`；封面 SHA-256：`b18900ed3d1fc0139d9ce50bbac51172f51cd0589b7e84062e70945e885d6a4b`。
- 首次下载取决于网络情况；本次跨境冷启动约两分钟，页面显示逐项校验进度。完成后缓存可复用，已经实际验证再次打开没有重新下载引擎。

上游 Windows/Web CI 和本地发布检查均已通过；前端完整托管构建工作流在记录时仍运行，不能把本地或线上验收写成该次远程 CI 已完成。

## 2026-10-17 性能更新

此前普通攻击会触发大量场景投影、名称扫描和对象复制。性能修复已通过上游 [PR #31](https://github.com/chnnasn/TomCat_Engine/pull/31)、[PR #33](https://github.com/chnnasn/TomCat_Engine/pull/33)、[PR #36](https://github.com/chnnasn/TomCat_Engine/pull/36) 合入，前后端统一升级至 `c28487215bd5df89b35c1d68252ba240231d9c4f`。上游最终 head 与合并提交六项 Windows/Web CI 全部通过。示例同时复用组件代理、减少重复分配、以原始图集半片替代拼接条带，并合并同帧击杀日志；保留伤害、随机调用、粒子、音效及销毁时机。

最终硬件 GPU 实测：八次普通攻击各区间最大 CPU 回调为 **5.955–19.310 ms**，原始基线为 357–375 ms；1080p 完整 120 秒聚敌后实际 43+17 杀并清场，活动窗口 CPU 回调 p95 为 **7.540 ms**、最大 **33.245 ms**，没有超过 50 ms 的回调。CPU 时间不等于显示帧率，该压力窗口仍记录了调度长间隔，完整数据与此前失败迭代见 [性能优化与回归](rougelike-performance.md)。

- 前端正式应用提交：[`abab8d1`](https://github.com/chnnasn/Tc_Engine_Web_Front/commit/abab8d1fc12b1d7cadf7dcc8fd2db1fc788b1131)。手动部署为 `6ad277c87d52cc46c053dac7`，随后同一提交的 Netlify 自动构建 `6ad277dc916de1bea3ad6628` 于 03:16（北京时间）发布，成为正式版本；后续线上实玩对应此自动构建。保留同期已合入的 Return 示例。前端 57 项测试、类型检查、生产构建和生产 C# 逻辑回归通过。
- 后端提交：[`77eb53c`](https://github.com/chnnasn/Tc_Engine_Web_backend/commit/77eb53cf08200f94121e0114dacde147f020dcf6)，Railway 部署 `a176b925-7f09-4870-9897-7836a269e064` 成功；镜像摘要 `sha256:1b01557eebfad946d2ab6b806439f5f246ccb2b0060cb17b2df293fceebc15ea`。构建日志确认正式引擎提交，Docker ENV 使用该 pin，平台不存在同名变量覆盖。未注册 SSH 凭证或执行容器 SSH；未改 Redis、数据卷或服务配置。直连及网站代理健康检查均返回 200。
- 后端 Release 构建通过，40 项测试通过、1 项 Redis 测试因未配置服务跳过；有 NuGet 漏洞索引不可达的 NU1900 警告。`9a0ccad7`、`5734c56a`、`0b8829a8` 三个真实旧版本的工程恢复与旧包播放均通过，保留明确兼容列表。
- 2026-10-17 03:18（北京时间），正式域名使用真实后端通过完整匿名实玩：菜单挥刀、首波五杀、升级进入第二波、接触死亡、M 返回、Enter 重开、WebAudio 非零输出、全屏、关闭清理及缓存复开。未用本地或模拟 API 替代线上结果。
- 正式游戏包为 17,558,164 字节、21 条目，SHA-256 为 `41103940f1faa52a7f8b1f8f92ef0625b70bd6d62b30758b775f0e2edadc7944`；源码 ZIP SHA-256 为 `046691657019ff62eeb18090a513ca78a20fe39ff4d3aeacf5ad35640d0b3eac`。可复用引擎归档见 [web-engine-c2848721](https://github.com/chnnasn/Tc_Engine_Web_Front/releases/tag/web-engine-c2848721)，SHA-256 为 `5592781c45dd2099e5e13520d634e6f8a718b7694d0d67638c0e8275a29a7e98`，GitHub 上传摘要与本地一致。
- 正式域名的引擎清单、游戏清单、TCPAK 与源码 ZIP 均与本地发布文件逐字节一致。自动构建的 HTML/应用入口文件名与本地构建不同，未声称二者字节相同；承载引擎 pin 的共享脚本字节一致，含正式提交及三个 legacy。实际主页保留 Return 与 Rougelike，详情页“下载示例工程”位于“开始游玩”按钮下方 12 px，链接和下载属性正确。

前端应用提交的远程完整构建工作流在本次发布记录时仍运行；上述上游 CI、本地测试和正式域名验收分别记录，不混称为前端远程 CI 已完成。
