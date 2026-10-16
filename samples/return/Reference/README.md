# Return 来源与编辑说明

本例根据用户提供的 `E:/Gitee/Return` Unity 工程提取。原工程保持只读。`import-report.json` 记录原场景 SHA-256；`assets.json` 记录每张导入图片的原文件、Sprite fileID 和 Tc 资源句柄。原工程随附的 GPL v3 文本保存在 `ORIGINAL-LICENSE.txt`；提供的 Assets 目录未发现额外的素材许可或署名说明。

## 原始内容

- 场景顺序为 Main → default（教学）→ Level1 → Level2 → Level3 → Level4 → Level5 → final。Main 是 Canvas 菜单，后七个场景包含实际 Tilemap。
- `source-layouts.png` 是从原始数据绘制的双世界位置对照图；各场景 JSON 保留原网格坐标、碰撞类型、物体与按钮目标、原始 CompositeCollider2D 轮廓。
- 角色速度 5 单位/秒，起跳速度 15，重力约 49.05 单位/秒²；碰撞盒为 0.5 × 0.8，中心偏移 `(0,-0.1)`。原项目物理步长为 0.02 秒。
- 触碰尖刺会在原地切换 Life/Death 世界，保留角色速度，在离开的世界留下朝向一致的尸体图像。它不会把角色传送回起点。
- 玩家或箱子持续压住按钮会触发对应门。教学场景有 8 个刻意重叠的按钮，各控制一个桥块，导入保留所有连接。
- A/D 或方向键移动，空格跳跃，R 重开，Esc 暂停；收集终点后延迟 1.5 秒进入下一场。final 的 Continue 原本回到 Level1。

## 原生 Tilemap 编辑

`Assets/Scene/Levels/*.tomcat` 是七个关卡的原生 Tc 编辑源，合计 27 个 `Tilemap2D`、770 个有图像的单元格。可以在 Tc 的 Tile Palette 中逐格绘制、擦除、翻转和旋转；不需要编辑一张整关截图。

1. 打开对应关卡 `.tomcat`，在层级中选择 `ReturnMap_<场景序号>_<图层序号>`。
2. Life 图层默认启用，Death 图层默认关闭。需要编辑另一世界时切换实体的 Active；原图层名称、Realm、碰撞属性可对照同名 Reference JSON。
3. 保存关卡。在下载工程根目录首次执行 `npm install`，随后每次执行 `npm run sync:maps`；重新打开 Tc 的运行入口并编译脚本。工具读取已保存的关卡，将原生网格合入可玩的总场景，不会覆盖这些关卡编辑源。网站源码仓库内执行 `npm run engine:return` 会自动同步并打包。
4. 每次构建同步更新 `ReturnLevels.cs` 的静态碰撞数据。`edited-tilemaps.json` 列出发生修改的图层。

保留 `ReturnMap_…` 实体名称与标识。要清空一个图层，请擦除单元格，而不是删除图层实体。装饰图层不产生碰撞；原碰撞图层支持本例已有碰撞轮廓的素材。更换为尚无碰撞资料的 Sprite 时构建会明确报错，避免出现可见地面没有碰撞的情况。支持网格位置、缩放、单元格尺寸，以及单格的翻转与 90 度旋转；整张网格的任意角度旋转需要另外设计碰撞。

未修改的图层使用原 Unity CompositeCollider2D 轮廓，去除极小的浮点扩张误差并对齐 1/16 单位源像素。修改后的图层按已有素材轮廓重建并合并相邻矩形。Tc 当前版本没有托管 TilemapCollider2D，因此碰撞同步发生在构建时；编辑器中单纯改图之后需重新构建游戏。

## 重建与验证

```powershell
python scripts/import-return.py --source E:/Gitee/Return
node scripts/return-tilemap.mjs
node scripts/return-tilemap.test.mjs
node scripts/build-return.mjs
```

Python 导入需要 PyYAML 与 Pillow。重新导入会刷新原始图片和原始数据；原生关卡编辑源只有不存在时才创建，已有文件不会被覆盖。测试在独立临时工程中验证绘制、保存、构建读取、碰撞更新和擦除恢复，不修改实际关卡。

导入图片保留原像素，使用 RGBA8、关闭 mipmap，并设置 `sRGB: false`，对应原 Unity 工程的 Gamma 色彩空间，避免现有 Tc 非线性输出路径把像素颜色重复解码而显著变暗。当前 Tc OpenGL 纹理采样仍是线性；未使用引擎不支持的 nearest 导入字段。`map-*.png` 仅在源码中保留作画面对照，不打入游戏包；可玩关卡只使用原生逐格 Tilemap。
