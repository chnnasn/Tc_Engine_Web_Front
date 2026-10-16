# 可编辑源码的独立同步工具

这些文件随下载的 `Return` 工程提供，不依赖 Tc 官网源码或原 Unity 工程。

1. 在 Tc 中编辑并保存 `Assets/Scene/Levels/` 中对应关卡的 Tilemap。
2. 在解压后的 `Return` 工程根目录执行一次 `npm install`。
3. 每次编辑关卡后执行 `npm run sync:maps`。
4. 在 Tc 中重新加载 `Assets/Scene/return.tomcat`，正常编译并运行或打包。

同步会保留入口场景中的相机、游戏控制器和其他物体，只更新具备 `ReturnMap_…` 名称的原生 Tilemap 副本，以及 `ReturnLevels.cs` 的静态碰撞数据。各关卡编辑源不会被覆盖。请在运行同步前保存关卡，避免编辑器随后用旧的入口场景覆盖同步结果。

绘制、擦除、翻转、旋转、单元格尺寸与碰撞规则详见 `Reference/README.md`。如果构建提示素材没有碰撞资料，请改用本例已有的地形素材；装饰图层不要求碰撞资料。
