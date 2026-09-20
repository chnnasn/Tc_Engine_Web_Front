// Generate a real TCPAK with the pinned upstream Cooker for the browser test.
const fs = require('node:fs');
const path = require('node:path');
const directory = path.resolve('.engine/player-fixture');
fs.mkdirSync(directory, {recursive:true});
fs.writeFileSync(path.join(directory,'package.json'), '{"type":"commonjs"}');
for (const ext of ['js','wasm','data']) fs.copyFileSync(path.resolve(`.engine/build/tomcat_player.${ext}`), path.join(directory,`tomcat_player.${ext}`));
(async () => {
  let module;
  try {
    module = await require(path.join(directory,'tomcat_player.js'))({locateFile:name=>path.join(directory,name)});
    if (module.ccall('tc_web_player_cook_sample','number',[],[]) !== 0) throw new Error(module.ccall('tc_web_player_error','string',[],[]));
    fs.writeFileSync(path.resolve('.engine/sample.tcpak'), module.FS.readFile('/PhysicsPlayground.tcpak'));
  } finally { module?.PThread.terminateAllThreads(); }
})().catch(error=>{console.error(error); process.exitCode=1;});
