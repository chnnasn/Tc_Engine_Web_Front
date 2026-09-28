// 用当前引擎的 Emscripten Player 夹具生成真实 TCPAK，供浏览器播放器回归使用。
// 托管（C#）构建不再把 Emscripten Player 作为发布产物，但 tomcat_player 目标仍会被构建：
// 上游的 tc_web_player_cook_sample 开发夹具只存在于这个目标里。
const fs = require('node:fs');
const path = require('node:path');
const build = path.resolve(process.env.TOMCAT_NATIVE_BUILD || '.engine/build-managed-native');
const directory = path.resolve('.engine/player-fixture');
for (const ext of ['js', 'wasm', 'data']) {
  const from = path.join(build, `tomcat_player.${ext}`);
  if (!fs.existsSync(from)) {
    console.error(`缺少 ${from}，请先运行 npm run engine:build（会同时构建测试夹具 tomcat_player）`);
    process.exit(1);
  }
}
fs.mkdirSync(directory, { recursive: true });
fs.writeFileSync(path.join(directory, 'package.json'), '{"type":"commonjs"}');
for (const ext of ['js', 'wasm', 'data']) fs.copyFileSync(path.join(build, `tomcat_player.${ext}`), path.join(directory, `tomcat_player.${ext}`));
(async () => {
  let module;
  try {
    module = await require(path.join(directory, 'tomcat_player.js'))({ locateFile: name => path.join(directory, name) });
    if (module.ccall('tc_web_player_cook_sample', 'number', [], []) !== 0) throw new Error(module.ccall('tc_web_player_error', 'string', [], []));
    fs.writeFileSync(path.resolve('.engine/sample.tcpak'), module.FS.readFile('/PhysicsPlayground.tcpak'));
  } finally {
    // 托管/新构建是单线程的，可能没有 pthread 池。
    try { module?.PThread?.terminateAllThreads?.(); } catch { /* 单线程构建。 */ }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
