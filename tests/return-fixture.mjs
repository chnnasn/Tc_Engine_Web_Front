// QA copies only. The published source/package never receives a boot override,
// diagnostic key, debug state accessor, or substituted scene.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validatePackage } from '../scripts/build-return.mjs'

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const production = join(root, 'samples/return'), scratch = join(root, '.engine')
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const excluded = path => relative(production, path).split(sep).some(part => ['Library', 'bin', 'obj', '.git'].includes(part))
export function productionReceipt() {
  const files = []
  const walk = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (excluded(path)) continue
      if (entry.isDirectory()) walk(path)
      else files.push([relative(production, path).replaceAll('\\', '/'), hash(readFileSync(path))])
    }
  }
  walk(production)
  files.sort((a, b) => a[0].localeCompare(b[0]))
  return hash(JSON.stringify(files))
}
const diagnostics = `
    // QA COPY ONLY: F8 reads managed state after a real update, without mutation.
    static string QaNumber(float value)=>value.ToString("R",System.Globalization.CultureInfo.InvariantCulture);
    void QaDump()
    {
        Log.Info("[ReturnQA] begin");
        Log.Info("[ReturnQA] state|"+(stage-1)+"|"+realm+"|"+QaNumber(player.X)+"|"+QaNumber(player.Y)+"|"+(player.Grounded?1:0)+"|"+(paused?1:0)+"|"+corpseCursor);
        var current=stages[stage];
        for(int i=0;i<current.Maps.Length;i++){var m=current.Maps[i];Log.Info("[ReturnQA] map|"+i+"|"+(m.Native is null?0:1)+"|"+(m.Visible?1:0));}
        for(int i=0;i<current.Items.Length;i++)
        {
            var item=current.Items[i];
            if(item.Body is {} box)Log.Info("[ReturnQA] box|"+i+"|"+QaNumber(box.X)+"|"+QaNumber(box.Y)+"|"+(box.Enabled?1:0));
            if(item.Source.Kind=="button")Log.Info("[ReturnQA] button|"+i+"|"+(item.Pressed?1:0)+"|"+item.Target);
            if(item.Source.Kind=="door")Log.Info("[ReturnQA] door|"+i+"|"+(item.DoorOn?1:0)+"|"+(item.Visual?.Visible==true?1:0));
        }
        Log.Info("[ReturnQA] end");
    }
`

export function buildFixture({ stage = 0, realm = 0, directory, mode = 'navigation' } = {}) {
  assert.ok(Number.isInteger(stage) && stage >= 0 && stage <= 6)
  assert.ok(realm === 0 || realm === 1)
  assert.ok(['navigation', 'legacy-flip'].includes(mode), 'Known isolated fixture mode')
  if (mode === 'legacy-flip') assert.ok(stage === 0 && realm === 0, 'Legacy flip retains the ordinary production menu')
  const productionTreeSha256 = productionReceipt()
  const sourcePath = join(production, 'Assets/Scripts/ReturnGame.cs')
  const original = readFileSync(sourcePath, 'utf8')
  const fixtureBuilderSha256 = hash(readFileSync(fileURLToPath(import.meta.url)))
  assert.ok(!original.includes('[ReturnQA]'), 'Production source must not contain QA diagnostics')
  const lock = JSON.parse(readFileSync(join(root, 'engine.lock.json'), 'utf8'))
  const player = resolve(process.env.TOMCAT_PLAYER_DIR || join(scratch, 'player-fixture'))
  const managed = resolve(process.env.TOMCAT_MANAGED_DIR || join(scratch, 'upgrade-managed'))
  const worker = resolve(process.env.TOMCAT_COOK_WORKER || join(root, '../Tc_Engine_Web_backend/cook/worker.mjs'))
  for (const path of [player, managed]) assert.equal(readFileSync(join(path, 'engine-commit.txt'), 'utf8').trim(), lock.commit, `Stale toolchain: ${path}`)
  const toolchainHashes = Object.fromEntries([
    join(player, 'tomcat_player.js'), join(player, 'tomcat_player.wasm'),
    join(managed, 'TomCat.Managed.dll'), join(managed, 'TomCat.ScriptGenerator.dll'),
  ].map(path => [relative(root, path).replaceAll('\\', '/'), hash(readFileSync(path))]))
  mkdirSync(scratch, { recursive: true })
  const existing = !!directory
  directory = directory ? resolve(directory) : mkdtempSync(join(scratch, mode === 'legacy-flip' ? 'return-legacy-flip-' : `return-level-${stage}-${realm}-`))
  assert.ok(directory.startsWith(scratch + sep), 'QA fixtures must stay under frontend/.engine')
  const packagePath = join(directory, 'return-qa.tcpak'), manifestPath = join(directory, 'fixture.json')
  // Level2's death trap occupies the original life spawn. Its realm-1 fixture
  // starts beside that trap so the measured realm cannot immediately flip back.
  const initialization = mode === 'legacy-flip' ? 'Load(0);' : `Load(${stage + 1});${realm ? ' realm=1;RefreshRealm();' : ''}${stage === 2 && realm === 1 ? ' player.Reset(2.5f,-6.45f);' : ''}`
  let manifest
  if (existing) {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    assert.equal(manifest.productionTreeSha256, productionTreeSha256, 'Production source changed: recook the fixture')
    assert.equal(manifest.fixtureBuilderSha256, fixtureBuilderSha256, 'QA diagnostics changed: recook the fixture')
    assert.equal(manifest.engineCommit, lock.commit)
    assert.equal(manifest.mode, mode)
    assert.equal(manifest.initialization, initialization)
    assert.deepEqual(manifest.toolchainHashes, toolchainHashes)
    assert.equal(manifest.packageSha256, hash(readFileSync(packagePath)))
  } else {
    const copy = join(directory, 'project')
    cpSync(production, copy, { recursive: true, filter: path => !excluded(path) })
    let modified = original
    if (mode === 'legacy-flip') {
      // Exercise the real generated managed Transform proxies and deferred
      // native setter path. Only the copied game's two TRS expressions change;
      // no diagnostic input, state accessor, boot override or native bypass.
      const replacements = [
        ['Vector3 scale=v.Sprite is null?Vector3.One:new(v.Size.X,v.Size.Y,1);',
          'Vector3 scale=v.Sprite is null?Vector3.One:new(v.Size.X*(v.FlipX?-1:1),v.Size.Y*(v.FlipY?-1:1),1);'],
        ['Vector3 rotation=new(v.FlipY?MathF.PI:0,v.FlipX?MathF.PI:0,v.Angle);',
          'Vector3 rotation=new(0,0,v.Angle);'],
      ]
      for (const [before, after] of replacements) {
        assert.equal(modified.split(before).length, 2, `Legacy flip source anchor changed: ${before}`)
        modified = modified.replace(before, after)
      }
      assert.ok(!modified.includes('[ReturnQA]') && !modified.includes('KeyCode.F9'), 'Legacy regression must use only normal production input')
    } else {
      for (const marker of ['        Load(0);', '        Flush();', '    void OnDestroy()=>audio?.Stop();']) {
        assert.equal(original.split(marker).length, 2, `Fixture source anchor changed: ${marker}`)
      }
      modified = original.replace('        Load(0);', `        ${initialization}`)
        .replace('        Flush();', `        Flush();
        // QA COPY ONLY: stage/realm selection is never compiled into production.
        if(Input.WasKeyPressed(KeyCode.F9))Load(stage==7?1:stage+1);
        if(Input.WasKeyPressed(KeyCode.F10)&&stage>0){realm=1-realm;RefreshRealm();if(stage==1&&realm==1)player.Reset(4.8f,-6.45f);if(stage==3&&realm==1)player.Reset(2.5f,-6.45f);Log.Info("[ReturnQA] realm:"+realm);}
        if(Input.WasKeyPressed(KeyCode.F8))QaDump();`)
        .replace('    void OnDestroy()=>audio?.Stop();', diagnostics + '\n    void OnDestroy()=>audio?.Stop();')
    }
    writeFileSync(join(copy, 'Assets/Scripts/ReturnGame.cs'), modified)
    const cooked = spawnSync(process.execPath, [worker, join(copy, 'Project.tcproj'), packagePath], {
      cwd: root, env: { ...process.env, TOMCAT_PLAYER_DIR: player, TOMCAT_MANAGED_DIR: managed }, stdio: 'inherit', timeout: 180000,
    })
    assert.equal(cooked.status, 0, `QA cook failed: ${cooked.error?.message || cooked.signal || cooked.status}`)
    const bytes = readFileSync(packagePath)
    manifest = { purpose: mode === 'legacy-flip' ? 'QA only: original negative XY scale and Z-only rotation through actual managed Transform setters. Normal production menu/input; no QA keys or state mutations.' : 'QA only: initial stage/realm, F9 stage navigation, F10 realm selection, read-only F8 diagnostics. Not a natural playthrough.',
      mode, stage, realm, engineCommit: lock.commit, productionTreeSha256, fixtureBuilderSha256, toolchainHashes, initialization,
      fixtureSourceSha256: hash(modified), packageSha256: hash(bytes), packageBytes: bytes.length, entries: validatePackage(bytes) }
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  }
  assert.equal(productionReceipt(), productionTreeSha256, 'Production project changed during fixture build')
  return { directory, packagePath, manifest }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argument = name => process.argv.find(value => value.startsWith(`--${name}=`))?.split('=').slice(1).join('=')
  console.log(JSON.stringify(buildFixture({ stage: Number(argument('stage') || 0), realm: Number(argument('realm') || 0), directory: argument('fixture'), mode: argument('mode') || 'navigation' }), null, 2))
}
