import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Run the actual game collision code in .NET, independent of the Tc runtime.
// No generated project, executable, or restore output enters the source tree.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const generated = join(root, '.engine')
mkdirSync(generated, { recursive: true })
const directory = mkdtempSync(join(generated, 'return-physics-'))
const xml = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;')
const source = join(root, 'samples/return/Assets/Scripts/ReturnPhysics.cs')
const levels = join(root, 'samples/return/Assets/Scripts/ReturnLevels.cs')
writeFileSync(join(directory, 'ReturnPhysics.Tests.csproj'), `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType><TargetFramework>net10.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings><Nullable>enable</Nullable>
    <EnableDefaultCompileItems>false</EnableDefaultCompileItems>
    <NuGetAudit>false</NuGetAudit>
  </PropertyGroup>
  <ItemGroup><Compile Include="Program.cs"/><Compile Include="${xml(source)}" Link="ReturnPhysics.cs"/><Compile Include="${xml(levels)}" Link="ReturnLevels.cs"/></ItemGroup>
</Project>
`)
writeFileSync(join(directory, 'NuGet.Config'), '<configuration><packageSources><clear /></packageSources></configuration>\n')
writeFileSync(join(directory, 'Program.cs'), String.raw`
using TomCatGame;

static class PhysicsTests
{
    static readonly ReturnBody[] NoBoxes = [];
    static readonly ReturnBounds[] NoSolids = [];
    static readonly ReturnBounds[] Floor = [new(0, -.5f, 100, 1)];
    static int passed;

    static void Require(bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException(message);
    }
    static void Near(float actual, float expected, string message, float tolerance=.0002f)
    {
        Require(Math.Abs(actual-expected) <= tolerance, $"{message}: expected {expected}, got {actual}");
    }
    static void Tick(ReturnBody body, float direction=0, ReturnBounds[]? solids=null, ReturnBody[]? boxes=null, int self=-1, bool push=false, ReturnBody? verticalObstacle=null)
    {
        solids ??= Floor; boxes ??= NoBoxes;
        body.VY -= ReturnPhysics.Gravity * ReturnPhysics.Step;
        ReturnPhysics.Move(body, direction * ReturnPhysics.Speed * ReturnPhysics.Step, body.VY * ReturnPhysics.Step,
            solids, solids.Length, boxes, boxes.Length, self, push, verticalObstacle);
    }
    static void Check(string name, Action action)
    {
        action(); passed++; Console.WriteLine($"PASS {name}");
    }
    static int Main()
    {
        try
        {
            Check("authored Level3 embedded box separates and remains usable after restart", () => {
                var level = ReturnLevels.All.Single(value => value.Name=="Level3");
                var source = level.Objects.Single(value => value.Id=="1449523891:1951573150192399104");
                var box = new ReturnBody(source.X,source.Y,source.ColliderW,source.ColliderH,source.OffsetX,source.OffsetY);
                Near(box.Bounds.Bottom,-7.08f,"source collider must retain the original embedded position");
                foreach(int realm in new[] {0,1})
                {
                    var solids = level.Maps.Where(map => map.Realm<0||map.Realm==realm)
                        .SelectMany(map => map.Solids).Select(rect => new ReturnBounds(rect.X,rect.Y,rect.W,rect.H)).ToArray();
                    for(int restart=0;restart<3;restart++)
                    {
                        box.Reset(source.X,source.Y);
                        ReturnPhysics.ResolveStaticOverlaps(box,solids,solids.Length);
                        Near(box.X,2.73f,"separation must preserve authored horizontal position");
                        Near(box.Y,-6.58f,"floor separates the initial 0.08 penetration");
                        Near(box.PreviousY,box.Y,"interpolation must not retain embedded pose");
                        for(int i=0;i<1200;i++)Tick(box,solids:solids);
                        Near(box.Y,-6.58f,"box must remain on the floor after ten seconds");
                        Require(box.Grounded,"box must remain grounded");
                    }
                }
            });
            Check("newly enabled geometry separates bodies without changing unobstructed motion", () => {
                ReturnBounds[] solids = [new(0,-.5f,10,1),new(2,2,1,4)];
                var body = new ReturnBody(1.1f,.45f,1,1) { VY=-3 };
                ReturnPhysics.ResolveStaticOverlaps(body,solids,solids.Length);
                Near(body.X,1,"new wall separates sideways");Near(body.Y,.5f,"new floor separates upwards");
                Near(body.VY,0,"opposed vertical velocity must clear");
                foreach(var solid in solids)Require(!body.Bounds.Overlaps(solid,.0001f),"corner separation left penetration");
                body.Reset(-2,4);body.VY=3;
                ReturnPhysics.ResolveStaticOverlaps(body,solids,solids.Length);
                Near(body.Y,4,"clear body was moved");Near(body.VY,3,"clear velocity was changed");
                body.Reset(0,-.2f);body.Enabled=false;
                ReturnPhysics.ResolveStaticOverlaps(body,solids,solids.Length);
                Near(body.Y,-.2f,"inactive body should keep its position");
            });
            Check("repeated geometry overlap recovery allocates zero managed bytes", () => {
                var body = new ReturnBody(0,.4f,1,1);
                for(int i=0;i<20000;i++){body.Reset(0,.4f);ReturnPhysics.ResolveStaticOverlaps(body,Floor,1);}
                long before=GC.GetAllocatedBytesForCurrentThread();
                for(int i=0;i<100000;i++){body.Reset(0,.4f);ReturnPhysics.ResolveStaticOverlaps(body,Floor,1);}
                Require(GC.GetAllocatedBytesForCurrentThread()==before,"overlap recovery allocated managed bytes");
            });
            Check("realm platform beside the floor cannot oscillate a box into the floor", () => {
                foreach(string name in new[] {"Level4","Level5"})
                {
                    var level=ReturnLevels.All.Single(value=>value.Name==name);
                    var solids=level.Maps.Where(map=>map.Realm<0||map.Realm==0).SelectMany(map=>map.Solids)
                        .Select(rect=>new ReturnBounds(rect.X,rect.Y,rect.W,rect.H)).ToArray();
                    var body=new ReturnBody(5.625f,-6.5f,.96f,.96f,-.042f,.06f);
                    ReturnPhysics.ResolveStaticOverlaps(body,solids,solids.Length);
                    foreach(var solid in solids)Require(!body.Bounds.Overlaps(solid,.0001f),$"{name} realm change left a static overlap");
                    Require(body.Bounds.Bottom>=-7.0001f,"realm separation must not push the box under the floor");
                    Require(Math.Abs(body.X-5.625f)<1.2f&&Math.Abs(body.Y+6.5f)<.01f,"nearest free position should be beside the activated platform");
                }
            });
            Check("all authored box spawns separate from maps and initially closed doors", () => {
                foreach(var level in ReturnLevels.All)
                foreach(int realm in new[] {0,1})
                {
                    var mapSolids=level.Maps.Where(map=>map.Realm<0||map.Realm==realm).SelectMany(map=>map.Solids)
                        .Select(rect=>new ReturnBounds(rect.X,rect.Y,rect.W,rect.H));
                    var objectSolids=level.Objects.Where(item=>item.Active&&(item.Realm<0||item.Realm==realm)&&item.Collide&&!item.Trigger
                        &&item.Kind is not "box" and not "player"&&(item.Kind!="door"||item.DisableWhenOn))
                        .Select(item=>new ReturnBounds(item.X+item.OffsetX,item.Y+item.OffsetY,item.ColliderW,item.ColliderH));
                    var solids=mapSolids.Concat(objectSolids).ToArray();
                    foreach(var item in level.Objects.Where(item=>item.Kind=="box"&&item.Active&&(item.Realm<0||item.Realm==realm)))
                    {
                        var body=new ReturnBody(item.X,item.Y,item.ColliderW,item.ColliderH,item.OffsetX,item.OffsetY);
                        ReturnPhysics.ResolveStaticOverlaps(body,solids,solids.Length);
                        foreach(var solid in solids)Require(!body.Bounds.Overlaps(solid,.0001f),$"{level.Name}/{realm}: authored box remains embedded");
                        Require(body.Bounds.Bottom>=-7.0001f&&body.Bounds.Top<=7.0001f,"authored box separated outside the room");
                    }
                }
            });
            Check("gravity lands and rests without drift", () => {
                var body = new ReturnBody(0, 10, 1, 1);
                Tick(body);
                Require(body.Y < 10 && body.VY < 0 && !body.Grounded, "free fall did not begin");
                for (int i=0; i<1200; i++) Tick(body);
                Near(body.Y, .5f, "floor position"); Near(body.VY, 0, "resting velocity");
                Require(body.Grounded, "resting body must be grounded");
            });
            Check("jump follows ballistic arc and returns to floor", () => {
                var body = new ReturnBody(0, .5f, 1, 1);
                Tick(body); Require(body.Grounded, "jump requires grounded start");
                body.VY = ReturnPhysics.Jump;
                float apex = body.Y; bool descending = false, landed = false;
                for (int i=0; i<120; i++)
                {
                    Tick(body); apex = Math.Max(apex, body.Y);
                    if (body.VY < 0) descending = true;
                    if (body.VY > 0) Require(!body.Grounded, "rising body cannot be grounded");
                    if (descending && body.Grounded) { landed=true; break; }
                }
                // Semi-implicit fixed integration is below the continuous 2.294-unit apex.
                Require(apex-.5f > 2.20f && apex-.5f < 2.31f, $"unexpected jump height {apex-.5f}");
                Require(landed, "jump did not land within one second"); Near(body.Y,.5f,"landing height");
            });
            Check("walking off a ledge clears grounded state", () => {
                ReturnBounds[] ledge = [new(0,-.5f,2,1)];
                var body = new ReturnBody(0,.5f,1,1);
                Tick(body, solids:ledge); Require(body.Grounded,"ledge start must be grounded");
                for (int i=0;i<60;i++) Tick(body,1,ledge);
                Require(body.X>2 && body.Y<.4f && !body.Grounded,"walking off ledge must fall");
            });
            Check("large motion cannot tunnel through floors walls or ceilings", () => {
                var fall = new ReturnBody(0,20,1,1) { VY=-1000 };
                ReturnPhysics.Move(fall,0,-100,Floor,Floor.Length,NoBoxes,0);
                Near(fall.Y,.5f,"swept floor collision"); Require(fall.Grounded,"fall must ground");
                ReturnBounds[] wall = [new(4,0,1,10)];
                var right = new ReturnBody(0,0,1,1);
                ReturnPhysics.Move(right,100,0,wall,wall.Length,NoBoxes,0);
                Near(right.X,3,"right wall collision");
                var left = new ReturnBody(8,0,1,1);
                ReturnPhysics.Move(left,-100,0,wall,wall.Length,NoBoxes,0);
                Near(left.X,5,"left wall collision");
                ReturnBounds[] ceiling = [new(0,4,10,1)];
                var rise = new ReturnBody(0,0,1,1) { VY=1000 };
                ReturnPhysics.Move(rise,0,100,ceiling,ceiling.Length,NoBoxes,0);
                Near(rise.Y,3,"swept ceiling collision"); Near(rise.VY,0,"ceiling resets velocity");
                Require(!rise.Grounded,"ceiling hit must not ground");
            });
            Check("nearest solid wins regardless of array order", () => {
                ReturnBounds[] farFirst = [new(7,0,1,10),new(4,0,1,10)];
                ReturnBounds[] nearFirst = [farFirst[1],farFirst[0]];
                var a = new ReturnBody(0,0,1,1); var b = new ReturnBody(0,0,1,1);
                ReturnPhysics.Move(a,100,0,farFirst,2,NoBoxes,0);
                ReturnPhysics.Move(b,100,0,nearFirst,2,NoBoxes,0);
                Near(a.X,3,"nearest wall"); Near(a.X,b.X,"order independence");
            });
            Check("pushing box into wall stops both bodies without overlap", () => {
                foreach (int direction in new[] {-1,1})
                {
                    ReturnBounds[] solids = [Floor[0],new(direction*3,2,1,4)];
                    var player = new ReturnBody(0,.5f,1,1);
                    var box = new ReturnBody(direction*1.5f,.5f,1,1);
                    ReturnBody[] boxes = [box];
                    for (int i=0;i<240;i++)
                    {
                        Tick(box,0,solids,boxes,0); Tick(player,direction,solids,boxes,push:true);
                        Require(!player.Bounds.Overlaps(box.Bounds,.0001f),"player overlapped pushed box");
                        Require(!box.Bounds.Overlaps(solids[1],.0001f),"box overlapped wall");
                    }
                    Near(box.X,direction*2,"box at wall"); Near(player.X,direction,"player behind box");
                }
            });
            Check("player lands on box and can jump off it", () => {
                var box = new ReturnBody(0,.5f,1,1); ReturnBody[] boxes = [box];
                var player = new ReturnBody(0,8,1,1);
                for (int i=0;i<500;i++) { Tick(box,boxes:boxes,self:0); Tick(player,boxes:boxes); }
                Near(player.Y,1.5f,"standing on box"); Require(player.Grounded,"box support must ground");
                player.VY=ReturnPhysics.Jump; Tick(player,boxes:boxes);
                Require(player.Y>1.5f && !player.Grounded,"jump off box failed");
                var fastFall = new ReturnBody(0,20,1,1);
                ReturnPhysics.Move(fastFall,0,-100,Floor,1,boxes,1);
                Near(fastFall.Y,1.5f,"fast fall must hit box before floor");
            });
            Check("disabled boxes do not block and active counts exclude unused slots", () => {
                var disabled = new ReturnBody(1,0,1,1) { Enabled=false };
                ReturnBody[] boxes = [disabled,new(3,0,1,1)];
                ReturnBounds[] solids = [new(50,0,1,10),new(1,0,1,10)];
                var player = new ReturnBody(0,0,1,1);
                ReturnPhysics.Move(player,5,0,solids,1,boxes,1);
                Near(player.X,5,"disabled or unused collider blocked motion");
            });
            Check("falling box rests on player and falls when player walks out", () => {
                foreach (int direction in new[] {-1,1})
                {
                    var player = new ReturnBody(0,.5f,.5f,.8f,0,-.1f);
                    var box = new ReturnBody(.042f,8,.96f,.96f,-.042f,.06f);
                    ReturnBody[] boxes = [box];
                    for (int i=0;i<360;i++)
                    {
                        Tick(box,boxes:boxes,self:0,verticalObstacle:player);
                        Tick(player,boxes:boxes,push:true);
                        Require(!player.Bounds.Overlaps(box.Bounds,.0001f),"falling box penetrated stationary player");
                    }
                    Near(box.Bounds.Bottom,player.Bounds.Top,"box rests on player head");
                    Near(box.VY,0,"supported box velocity");Require(box.Grounded,"supported box must be grounded");
                    for (int i=0;i<240;i++)
                    {
                        Tick(box,boxes:boxes,self:0,verticalObstacle:player);
                        Tick(player,direction,boxes:boxes,push:true);
                        Require(!player.Bounds.Overlaps(box.Bounds,.0001f),"box overlapped player while walking out");
                    }
                    Near(box.Bounds.Bottom,0,"unsupported box falls to floor");
                    Require(Math.Abs(player.X)>5,"player could not leave beneath box");
                }
            });
            Check("fast falling box respects player obstacle and disabled obstacle is ignored", () => {
                var player = new ReturnBody(0,.5f,.5f,.8f,0,-.1f);
                var box = new ReturnBody(0,20,1,1) { VY=-1000 };
                ReturnPhysics.Move(box,0,-100,Floor,1,NoBoxes,0,verticalObstacle:player);
                Near(box.Bounds.Bottom,player.Bounds.Top,"swept player-head collision");
                Near(box.VY,0,"head collision resets falling velocity");
                player.Enabled=false;box.Reset(0,20);
                ReturnPhysics.Move(box,0,-100,Floor,1,NoBoxes,0,verticalObstacle:player);
                Near(box.Bounds.Bottom,0,"disabled player should not support box");
            });
            Check("collider offsets remain aligned after landing and reset", () => {
                var body = new ReturnBody(0,8,.8f,1.4f,.2f,-.3f);
                for (int i=0;i<240;i++) Tick(body);
                Near(body.Bounds.Bottom,0,"offset collider rests on floor"); Near(body.Y,1,"offset object origin");
                body.Reset(4,5);
                Near(body.X,4,"reset x"); Near(body.Y,5,"reset y"); Near(body.PreviousX,4,"reset interpolation x");
                Near(body.PreviousY,5,"reset interpolation y"); Near(body.VY,0,"reset velocity");
                Require(body.Enabled && !body.Grounded,"reset state incorrect");
            });
            Check("steady fixed-step collision allocates zero managed bytes", () => {
                var body = new ReturnBody(0,.5f,1,1);
                for (int i=0;i<20000;i++) Tick(body);
                long before = GC.GetAllocatedBytesForCurrentThread();
                for (int i=0;i<100000;i++) Tick(body);
                long allocated = GC.GetAllocatedBytesForCurrentThread()-before;
                Require(allocated==0,$"hot collision loop allocated {allocated} bytes");
            });
            Check("falling-box player support allocates zero managed bytes", () => {
                var player = new ReturnBody(0,.5f,.5f,.8f,0,-.1f);
                var box = new ReturnBody(0,8,1,1);
                ReturnBody[] boxes = [box];
                for (int i=0;i<20000;i++) Tick(box,boxes:boxes,self:0,verticalObstacle:player);
                long before = GC.GetAllocatedBytesForCurrentThread();
                for (int i=0;i<100000;i++) Tick(box,boxes:boxes,self:0,verticalObstacle:player);
                long allocated = GC.GetAllocatedBytesForCurrentThread()-before;
                Require(allocated==0,$"box/player support loop allocated {allocated} bytes");
            });
            Console.WriteLine($"Return physics: {passed} scenarios passed.");
            return 0;
        }
        catch (Exception exception)
        {
            Console.Error.WriteLine(exception); return 1;
        }
    }
}
`)
const result = spawnSync('dotnet', ['run', '--project', join(directory, 'ReturnPhysics.Tests.csproj'), '--configuration', 'Release', '--nologo'], {
  cwd: directory,
  encoding: 'utf8',
  timeout: 120_000,
  windowsHide: true,
  env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1' },
})
if (result.stdout) process.stdout.write(result.stdout)
if (result.stderr) process.stderr.write(result.stderr)
if (result.error) throw result.error
assert.equal(result.status, 0, `Return physics harness failed (generated project: ${directory})`)
assert.match(result.stdout, /Return physics: 18 scenarios passed\./)
