using System;
using System.Collections.Generic;
using TomCat;

namespace TomCatGame;

// The original Unity coordinates and assets are used directly. Gameplay stays in
// Tc's managed runtime; no browser overlay, external physics, or frame callbacks.
public sealed class ReturnGame : MonoBehaviour
{
    const ulong Font = 6200000000000000020UL;
    const int CorpseCapacity = 64;
    const string LifeText="生 / LIFE",DeathText="死 / DEATH";
    const string SoundOnText="M  静音",SoundOffText="M  开启声音";
    const string PausedText="已暂停 / P / ESC 继续",TransitionText="抵达终点 / 正在前往下一关";
    static string HeadingText(int value)=>value==1?"序章 / 教学":value==7?"归途 / 终章":"第 "+(value-1)+" 关";
    static string ProgressText(int value)=>value==1?"教学关\n\n观察 / 尝试\n\n触碰尖刺\n切换生死世界":value==7?"最后的回声\n\n离开平台\n再次进入另一面":"关卡 "+(value-1)+" / 5\n\n两侧地形不同\n寻找抵达终点的路";
    static string HintText(int value)=>"A / D  左右移动\n方向键也可移动\n\nSPACE  跳跃\nR  重开当前关卡\nP / ESC  暂停"+(value==1?"\n\n箱子或角色\n都能压住按钮":"");
    static readonly Color White = new(1,1,1,1), Muted = new(.68f,.76f,.8f,1);
    sealed class Visual
    {
        public Entity Entity=null!;
        public Transform? Transform;
        public SpriteRenderer? Sprite;
        public TextRenderer? Label;
        public Vector2 Position,Size=Vector2.One;
        public Vector3 LastPosition,LastScale,LastRotation;
        public Color Color=White,LastColor;
        public ulong Texture,LastTexture;
        public float Angle,FontSize,TextHeight;
        public int Order;
        public string? Text,LastText;
        public bool Visible,Initialized,Applied,LastVisible,FlipX,FlipY;
    }
    sealed class Item
    {
        public ReturnObject Source=null!;
        public ReturnBounds Bounds;
        public ReturnBody? Body;
        public Visual? Visual;
        public int Target=-1,Button=-1;
        public bool Pressed,DoorOn,Visible,Collected;
    }
    sealed class Map
    {
        public ReturnMap Source=null!;
        public Entity? Native;
        public bool Visible;
    }
    sealed class Stage
    {
        public ReturnLevel Source=null!;
        public Item[] Items=[];
        public Map[] Maps=[];
        public ReturnBody[] Boxes=[];
    }
    sealed class Corpse
    {
        public Visual Visual=null!;
        public int Stage=-1,Realm;
    }
    readonly List<Visual> visuals=[];
    readonly List<Visual> menu=[];
    readonly Corpse[] corpses=new Corpse[CorpseCapacity];
    Stage[] stages=[];
    ReturnBounds[] solids=[];
    readonly ReturnBody player=new(0,0,.5f,.8f,0,-.1f);
    Visual hero=null!,heading=null!,realmLabel=null!,pauseLabel=null!,hint=null!,progress=null!,soundLabel=null!;
    Visual finalThanks=null!,finalAgain=null!,finalExit=null!,fontWarmup=null!;
    ReturnNativeAudio audio=null!;
    Camera camera=null!;
    Entity viewport=null!;
    RectTransform? viewportRect;
    int stage,realm,solidCount,corpseCursor,pendingStage=-1,warmupFrames;
    float accumulator,clock,jumpBuffer,transition,trapCooldown,lastHeight=-1;
    float viewportWidth=1280,viewportHeight=720,worldHeight=16.875f;
    bool paused,muted,facingLeft,ready,solidsDirty=true;

    void Awake()
    {
        camera=World.Find("MainCamera")!.GetComponent<Camera>();
        camera.Entity.GetComponent<Transform>().Position=new(0,0,-10);
        camera.BackgroundColor=new(29/255f,33/255f,45/255f,1);
        camera.Vignette=0;camera.Saturation=1;camera.Exposure=0;
        var canvas=World.CreateEntity("ReturnViewportMetrics");
        canvas.AddComponent<Canvas>().ScaleMode=CanvasScaleMode.ConstantPixelSize;
        viewport=World.CreateEntity("ReturnViewportRect",default,canvas);
        var rect=viewport.AddComponent<RectTransform>();
        rect.AnchorMin=Vector2.Zero;rect.AnchorMax=Vector2.One;rect.SizeDelta=Vector2.Zero;
        audio=new ReturnNativeAudio();
        BuildPools();
        Load(0);
    }

    Visual Sprite(string name,ulong texture,float x,float y,float w,float h,int order=0)
    {
        var entity=World.CreateEntity(name,new Vector3(10000,10000,0));
        entity.AddComponent<SpriteRenderer>();
        var visual=new Visual{Entity=entity,Texture=texture,Position=new(x,y),Size=new(w,h),Order=order};
        visuals.Add(visual);return visual;
    }
    Visual Text(string name,string text,float x,float y,float size,Color color)
    {
        var entity=World.CreateEntity(name,new Vector3(10000,10000,0));
        entity.AddComponent<TextRenderer>();
        var visual=new Visual{Entity=entity,Text=text,Position=new(x,y),FontSize=size,Color=color,Order=250};
        visuals.Add(visual);return visual;
    }
    void BuildPools()
    {
        stages=new Stage[ReturnLevels.All.Length];int maximumSolids=0;
        for(int s=0;s<stages.Length;s++)
        {
            var data=ReturnLevels.All[s];var current=new Stage{Source=data,Items=new Item[data.Objects.Length],Maps=new Map[data.Maps.Length]};
            stages[s]=current;int capacity=data.Objects.Length,boxCount=0;
            for(int m=0;m<data.Maps.Length;m++)
            {
                var map=data.Maps[m];var native=World.Find("ReturnMap_"+s+"_"+m)
                    ??throw new InvalidOperationException("Missing native Return Tilemap; run the map sync tool before cooking.");
                var runtime=new Map{Source=map,Native=native};current.Maps[m]=runtime;
                if(native is not null)native.ActiveSelf=false;
                capacity+=map.Solids.Length;
            }
            maximumSolids=Math.Max(maximumSolids,capacity);
            var ids=new Dictionary<string,int>();
            for(int i=0;i<data.Objects.Length;i++)
            {
                var source=data.Objects[i];var item=new Item{Source=source,Bounds=Collider(source)};
                current.Items[i]=item;ids[source.Id]=i;
                if(source.Kind=="box") { item.Body=new(source.X,source.Y,source.ColliderW,source.ColliderH,source.OffsetX,source.OffsetY);boxCount++; }
                if(source.Texture!=0&&source.Kind!="player")
                {
                    item.Visual=Sprite("Return "+s+" "+source.Name+" "+i,source.Texture,source.X,source.Y,source.Width,source.Height,source.Order+10);
                    item.Visual.Color=new(source.R,source.G,source.B,source.A);
                    item.Visual.Angle=source.Angle*MathF.PI/180;
                    item.Visual.FlipX=source.FlipX;item.Visual.FlipY=source.FlipY;
                }
            }
            current.Boxes=new ReturnBody[boxCount];int box=0;
            for(int i=0;i<current.Items.Length;i++)
            {
                var item=current.Items[i];
                if(item.Body is not null)current.Boxes[box++]=item.Body;
                if(item.Source.Kind=="button"&&ids.TryGetValue(item.Source.TargetId,out int target))item.Target=target;
                if(item.Source.Name=="Bulb")
                {
                    int colon=item.Source.Id.IndexOf(':');
                    if(colon>0)
                    {
                        string prefix=item.Source.Id[..(colon+1)];
                        for(int j=0;j<current.Items.Length;j++)if(current.Items[j].Source.Kind=="button"&&current.Items[j].Source.Id.StartsWith(prefix,StringComparison.Ordinal)){item.Button=j;break;}
                    }
                }
            }
        }
        solids=new ReturnBounds[Math.Max(1,maximumSolids)];
        hero=Sprite("Return player",ReturnArt.Idle[0],0,0,1,1,110);
        for(int i=0;i<corpses.Length;i++)corpses[i]=new Corpse{Visual=Sprite("Return body "+i,ReturnArt.Dead,0,0,1,1,105)};
        menu.Add(Sprite("Return title plate",ReturnArt.Title,0,3.3f,12,120f/490*12,150));
        menu.Add(Text("Return original title","Echo World",-2.3f,5.5f,.6f,White));
        menu.Add(Text("Return subtitle","归途",-.65f,1.0f,.6f,Muted));
        menu.Add(Sprite("Return start plate",ReturnArt.Start,0,-1.3f,8,120f/485*8,150));
        menu.Add(Text("Return start","按 ENTER 或点击开始",-3.5f,-3.0f,.46f,White));
        menu.Add(Text("Return menu story","在生与死的两面，寻找回去的路。",-6.3f,-4.4f,.46f,Muted));
        menu.Add(Text("Return menu controls","A / D 移动    空格跳跃    R 重来",-5.8f,-5.7f,.42f,Muted));
        menu.Add(Text("Return menu footer","Return / Tc 引擎复原",-3.8f,-6.9f,.4f,Muted));
        heading=Text("Return stage","",-14.2f,6.8f,.52f,White);
        realmLabel=Text("Return realm","",-14.2f,5.8f,.40f,new(.55f,.84f,.75f,1));
        hint=Text("Return hints","",-14.2f,3.8f,.42f,Muted);
        progress=Text("Return progress","",8.8f,6.8f,.42f,Muted);
        soundLabel=Text("Return sound",SoundOnText,8.8f,-6.9f,.4f,Muted);
        pauseLabel=Text("Return pause","",-4.2f,7.8f,.40f,new(1,.85f,.5f,1));
        finalThanks=Text("Return thanks","谢谢游玩",-2.5f,3.0f,.65f,White);
        finalAgain=Text("Return replay","重新开始",-4.0f,-5.8f,.34f,White);
        finalExit=Text("Return exit","返回菜单",1.9f,-5.8f,.34f,White);
        // Submit the exact UI glyph union before play. FontManager prepares
        // missing glyphs synchronously on Web, then publishes on later ticks.
        var glyphs=new SortedSet<char>();
        // FontManager tracks line breaks as requested codepoints too.
        void Include(string text){foreach(char glyph in text)glyphs.Add(glyph);}
        foreach(var visual in visuals)if(visual.Text is {} text)Include(text);
        for(int value=1;value<stages.Length;value++){Include(HeadingText(value));Include(ProgressText(value));Include(HintText(value));}
        Include(LifeText);Include(DeathText);Include(SoundOnText);Include(SoundOffText);Include(PausedText);Include(TransitionText);
        var characters=new char[glyphs.Count];glyphs.CopyTo(characters);
        fontWarmup=Text("Return menu font warmup",new string(characters),10000,10000,.4f,new(1,1,1,0));
        menu.Add(fontWarmup);
    }

    static ReturnBounds Collider(ReturnObject source)
    {
        // The importer has already rotated offsets and expanded the collider AABB.
        return new(source.X+source.OffsetX,source.Y+source.OffsetY,source.ColliderW,source.ColliderH);
    }
    bool RealmActive(int value)=>value<0||value==realm;
    void Load(int next)
    {
        stage=next;realm=0;accumulator=jumpBuffer=transition=trapCooldown=0;pendingStage=-1;paused=false;facingLeft=false;
        for(int i=0;i<corpses.Length;i++){corpses[i].Stage=-1;corpses[i].Visual.Visible=false;}
        corpseCursor=0;
        foreach(var current in stages)foreach(var item in current.Items)
        {
            item.Pressed=item.DoorOn=item.Collected=false;
            if(item.Body is {} body)
            {
                body.Reset(item.Source.X,item.Source.Y);
                if(item.Visual is not null)item.Visual.Position=new(body.X,body.Y);
            }
        }
        var data=stages[stage].Source;player.Reset(data.SpawnX,data.SpawnY);
        hero.Position=new(player.X,player.Y);hero.Texture=ReturnArt.Idle[0];hero.FlipX=false;
        foreach(var visual in menu)visual.Visible=stage==0;
        fontWarmup.Visible=stage==0&&!ready;
        hero.Visible=stage>0;
        heading.Visible=realmLabel.Visible=hint.Visible=progress.Visible=soundLabel.Visible=stage>0;
        heading.Text=HeadingText(stage);progress.Text=ProgressText(stage);hint.Text=HintText(stage);
        RefreshRealm();
        if(stage>0)Log.Info("[Return] stage:"+(stage-1)+" "+data.Name);
        else Log.Info("[Return] menu");
    }
    void RefreshRealm()
    {
        for(int s=0;s<stages.Length;s++)
        {
            var current=stages[s];
            foreach(var map in current.Maps)
            {
                bool visible=s==stage&&stage>0&&RealmActive(map.Source.Realm);
                if(map.Native is not null&&map.Visible!=visible)map.Native.ActiveSelf=visible;
                map.Visible=visible;
            }
            foreach(var item in current.Items)
            {
                item.Visible=s==stage&&stage>0&&item.Source.Active&&RealmActive(item.Source.Realm);
                if(item.Body is not null)item.Body.Enabled=item.Visible;
                if(item.Visual is not null)item.Visual.Visible=item.Visible&&!item.Collected&&(item.Source.Kind!="door"||(item.Source.DisableWhenOn?!item.DoorOn:item.DoorOn));
            }
        }
        foreach(var corpse in corpses)corpse.Visual.Visible=corpse.Stage==stage&&corpse.Realm==realm;
        realmLabel.Text=realm==0?LifeText:DeathText;
        realmLabel.Color=realm==0?new(.55f,.84f,.75f,1):new(.8f,.64f,.95f,1);
        finalThanks.Visible=finalAgain.Visible=finalExit.Visible=stage==7&&realm==1;
        solidsDirty=true;
    }
    void RebuildSolids()
    {
        solidCount=0;var current=stages[stage];
        foreach(var map in current.Maps)if(RealmActive(map.Source.Realm))foreach(var rect in map.Source.Solids)solids[solidCount++]=new(rect.X,rect.Y,rect.W,rect.H);
        foreach(var item in current.Items)
        {
            var source=item.Source;
            if(!item.Visible||!source.Collide||source.Trigger||source.Kind is "player" or "box")continue;
            if(source.Kind=="door"&&(source.DisableWhenOn?item.DoorOn:!item.DoorOn))continue;
            solids[solidCount++]=item.Bounds;
        }
        solidsDirty=false;
    }
    void SetPaused(bool value)
    {
        if(paused==value)return;paused=value;accumulator=jumpBuffer=0;
        player.PreviousX=player.X;player.PreviousY=player.Y;
        foreach(var box in stages[stage].Boxes){box.PreviousX=box.X;box.PreviousY=box.Y;}
        Log.Info("[Return] paused:"+(paused?"true":"false"));
    }
    void Update()
    {
        if(viewportRect is null&&viewport.IsValid)viewportRect=viewport.GetComponent<RectTransform>();
        if(viewportRect is not null)
        {
            var rect=viewportRect.RuntimeRect;
            if(rect.Width>0&&rect.Height>0){viewportWidth=rect.Width;viewportHeight=rect.Height;}
        }
        worldHeight=Math.Max(16.875f,30*viewportHeight/Math.Max(1,viewportWidth));
        if(worldHeight!=lastHeight){camera.OrthographicSize=worldHeight;lastHeight=worldHeight;}
        if(Input.WasKeyPressed(KeyCode.M))
        {
            muted=!muted;soundLabel.Text=muted?SoundOffText:SoundOnText;
            Log.Info("[Return] mute:"+(muted?"true":"false"));
        }
        float dt=Math.Clamp(Time.DeltaTime,0,ReturnPhysics.Step*8);
        if(stage==0)
        {
            bool click=false;
            if(Input.WasMouseButtonPressed(MouseButton.Left))
            {
                var mouse=Input.MousePosition;float x=(mouse.X-viewportWidth*.5f)*worldHeight/viewportHeight,y=(viewportHeight*.5f-mouse.Y)*worldHeight/viewportHeight;
                click=Math.Abs(x)<4&&Math.Abs(y+1.3f)<1;
            }
            if(ready&&(Input.WasKeyPressed(KeyCode.Enter)||click))Load(1);
        }
        else
        {
            if(!Input.IsWindowFocused)SetPaused(true);
            else if(Input.WasKeyPressed(KeyCode.P)||Input.WasKeyPressed(KeyCode.Escape))SetPaused(!paused);
            if(Input.WasKeyPressed(KeyCode.R)){Log.Info("[Return] restart");Load(stage);}
            if(!paused)
            {
                clock+=dt;
                if(transition>0)
                {
                    transition-=dt;
                    if(transition<=0&&pendingStage>=0)Load(pendingStage);
                }
                else
                {
                    if(Input.WasKeyPressed(KeyCode.Space))jumpBuffer=.12f;
                    float direction=(Input.IsKeyHeld(KeyCode.D)||Input.IsKeyHeld(KeyCode.Right)?1:0)-(Input.IsKeyHeld(KeyCode.A)||Input.IsKeyHeld(KeyCode.Left)?1:0);
                    if(direction!=0)facingLeft=direction<0;
                    accumulator=Math.Min(accumulator+dt,ReturnPhysics.Step*8);
                    int steps=0;
                    while(accumulator>=ReturnPhysics.Step&&steps++<8)
                    {
                        Simulate(direction);accumulator=Math.Max(0,accumulator-ReturnPhysics.Step);
                        if(transition>0)break;
                    }
                    RenderBodies(direction,Math.Clamp(accumulator/ReturnPhysics.Step,0,1));
                }
            }
        }
        pauseLabel.Visible=stage>0&&(paused||transition>0);
        pauseLabel.Text=paused?PausedText:TransitionText;
        audio.Tick(stage==0?-1:stage==1?1:0,paused,muted);
        Flush();
        // Three completed initialization ticks cover prepare, publish/backlog,
        // and publication of the complete glyph union in this Web runtime.
        if(!ready&&hero.Initialized&&audio.Ready&&++warmupFrames>=3)
        {
            ready=true;fontWarmup.Visible=false;
            Log.Info("[Return] ready: native Tc platform puzzle, tutorial + 5 levels + final");
        }
    }
    void Simulate(float direction)
    {
        var current=stages[stage];float dt=ReturnPhysics.Step;
        player.PreviousX=player.X;player.PreviousY=player.Y;
        if(solidsDirty)
        {
            RebuildSolids();
            foreach(var box in current.Boxes)ReturnPhysics.ResolveStaticOverlaps(box,solids,solidCount);
            ReturnPhysics.ResolveStaticOverlaps(player,solids,solidCount);
        }
        for(int i=0;i<current.Boxes.Length;i++)
        {
            var box=current.Boxes[i];box.PreviousX=box.X;box.PreviousY=box.Y;
            if(!box.Enabled)continue;
            box.VY-=ReturnPhysics.Gravity*dt;
            ReturnPhysics.Move(box,0,box.VY*dt,solids,solidCount,current.Boxes,current.Boxes.Length,i,verticalObstacle:player);
        }
        if(jumpBuffer>0&&player.Grounded)
        {
            player.VY=ReturnPhysics.Jump;jumpBuffer=0;audio.Cue(2);Log.Info("[Return] jump");
        }
        jumpBuffer=Math.Max(0,jumpBuffer-dt);
        player.VY-=ReturnPhysics.Gravity*dt;
        ReturnPhysics.Move(player,direction*ReturnPhysics.Speed*dt,player.VY*dt,solids,solidCount,current.Boxes,current.Boxes.Length,push:true);
        UpdateButtons(current);
        trapCooldown=Math.Max(0,trapCooldown-dt);
        foreach(var item in current.Items)
        {
            if(!item.Visible||item.Collected||!item.Source.Trigger||!player.Bounds.Overlaps(item.Bounds))continue;
            if(item.Source.Kind=="trap"&&trapCooldown<=0)
            {
                var corpse=corpses[corpseCursor++%corpses.Length];corpse.Stage=stage;corpse.Realm=realm;
                corpse.Visual.Position=new(player.X,player.Y);corpse.Visual.FlipX=facingLeft;
                realm=1-realm;trapCooldown=.15f;audio.Cue(3);
                RefreshRealm();UpdateButtons(current);
                Log.Info("[Return] realm:"+realm);break;
            }
            if(item.Source.Kind is "goal" or "continue" or "exit")
            {
                item.Collected=true;if(item.Visual is not null)item.Visual.Visible=false;
                audio.Cue(4);transition=1.5f;
                pendingStage=item.Source.Kind=="continue"?2:item.Source.Kind=="exit"?0:Math.Min(stage+1,stages.Length-1);
                Log.Info("[Return] win:"+(stage-1));break;
            }
        }
        // Escape from edited maps without a lower boundary is recoverable by R.
        if(player.Y < -80){Log.Info("[Return] restart: out-of-bounds");Load(stage);}
    }
    void UpdateButtons(Stage current)
    {
        foreach(var item in current.Items)if(item.Source.Kind=="door")item.DoorOn=false;
        foreach(var item in current.Items)
        {
            if(item.Source.Kind!="button")continue;
            bool pressed=item.Visible&&player.Bounds.Overlaps(item.Bounds,-.002f);
            if(item.Visible&&!pressed)foreach(var box in current.Boxes)if(box.Enabled&&box.Bounds.Overlaps(item.Bounds,-.002f)){pressed=true;break;}
            if(item.Pressed!=pressed)
            {
                item.Pressed=pressed;solidsDirty=true;
                Log.Info("[Return] button:"+item.Source.Id+":"+(pressed?"true":"false"));
            }
            if(pressed&&item.Target>=0)current.Items[item.Target].DoorOn=true;
            if(item.Visual is not null)item.Visual.Texture=pressed?ReturnArt.ButtonOn[0]:item.Source.Texture;
        }
        foreach(var item in current.Items)
        {
            if(item.Source.Kind=="door"&&item.Visual is not null)item.Visual.Visible=item.Visible&&(item.Source.DisableWhenOn?!item.DoorOn:item.DoorOn);
            if(item.Button>=0&&item.Visual is not null)item.Visual.Texture=current.Items[item.Button].Pressed?ReturnArt.BulbOn[(int)(clock*8)%ReturnArt.BulbOn.Length]:item.Source.Texture;
        }
    }
    void RenderBodies(float direction,float blend)
    {
        hero.Position=new(player.PreviousX+(player.X-player.PreviousX)*blend,player.PreviousY+(player.Y-player.PreviousY)*blend);
        hero.FlipX=facingLeft;
        var frames=!player.Grounded?ReturnArt.Fall:direction!=0?ReturnArt.Run:ReturnArt.Idle;
        hero.Texture=frames[(int)(clock*(direction!=0?12:6))%frames.Length];
        foreach(var item in stages[stage].Items)if(item.Body is {} box&&item.Visual is {} visual)
            visual.Position=new(box.PreviousX+(box.X-box.PreviousX)*blend,box.PreviousY+(box.Y-box.PreviousY)*blend);
    }
    void Flush()
    {
        foreach(var v in visuals)
        {
            if(!v.Initialized)
            {
                if(!v.Entity.IsValid)continue;
                v.Transform=v.Entity.GetComponent<Transform>();
                if(v.Text is not null)
                {
                    v.Label=v.Entity.GetComponent<TextRenderer>();v.Label.Font=new(Font);v.Label.FontSize=v.FontSize;
                    v.Label.MaxWidth=0;v.Label.LineSpacing=1.4f;
                }
                else {v.Sprite=v.Entity.GetComponent<SpriteRenderer>();v.Sprite.OrderInLayer=v.Order;}
                v.Initialized=true;
            }
            if(v.Text is not null&&v.Text!=v.LastText)
            {
                int lines=1;foreach(char character in v.Text)if(character=='\n')lines++;
                v.TextHeight=v.FontSize*(1+(lines-1)*1.4f);
            }
            // Tc anchors the complete line box at its bottom. Author labels by
            // their top edge so multiline instructions cannot overlap headings.
            Vector3 position=new(v.Position.X,v.Position.Y-v.TextHeight,-v.Order*.002f);
            // A half turn around Y mirrors the 2D sprite horizontally without
            // an ambiguous negative scale decomposition. Keep its size positive
            // so a later facing change cannot inherit a rotation from scale.
            Vector3 scale=v.Sprite is null?Vector3.One:new(v.Size.X,v.Size.Y,1);
            Vector3 rotation=new(v.FlipY?MathF.PI:0,v.FlipX?MathF.PI:0,v.Angle);
            if(!v.Applied||!position.Equals(v.LastPosition)){v.Transform!.Position=position;v.LastPosition=position;}
            if(!v.Applied||!scale.Equals(v.LastScale)){v.Transform!.Scale=scale;v.LastScale=scale;}
            if(!v.Applied||!rotation.Equals(v.LastRotation)){v.Transform!.RotationEuler=rotation;v.LastRotation=rotation;}
            if(v.Sprite is not null)
            {
                if(!v.Applied||v.Texture!=v.LastTexture){v.Sprite.Sprite=new(v.Texture);v.LastTexture=v.Texture;}
                if(!v.Applied||!v.Color.Equals(v.LastColor))v.Sprite.Color=v.Color;
                if(!v.Applied||v.Visible!=v.LastVisible)v.Sprite.Enabled=v.Visible;
            }
            if(v.Label is not null)
            {
                if(!v.Applied||!v.Color.Equals(v.LastColor))v.Label.Color=v.Color;
                if(!v.Applied||v.Visible!=v.LastVisible)v.Label.Enabled=v.Visible;
                if(v.Text!=v.LastText){v.Label.Text=v.Text!;v.LastText=v.Text;}
            }
            v.LastColor=v.Color;v.LastVisible=v.Visible;v.Applied=true;
        }
    }
    void OnDestroy()=>audio?.Stop();
}

// Original source bindings: jump is hit.ogg at .3, death is stair_down.ogg.
// Fixed AudioSource instances avoid creating sources or entities during gameplay.
internal sealed class ReturnNativeAudio
{
    readonly Entity[] entities=new Entity[5];
    readonly AudioSource?[] sources=new AudioSource?[5];
    readonly bool[] pending=new bool[5],suspended=new bool[5];
    static readonly ulong[] Handles=[6200000000000000030UL,6200000000000000035UL,6200000000000000032UL,6200000000000000034UL,6200000000000000033UL];
    static readonly float[] Volumes=[.5f,.5f,.3f,1,1];
    int playing=-1;
    bool wasPaused,wasMuted,initialized;
    public bool Ready=>initialized;
    public ReturnNativeAudio()
    {
        for(int i=0;i<entities.Length;i++)
        {
            var entity=World.CreateEntity("Return native audio "+i);entities[i]=entity;
            var source=entity.AddComponent<AudioSource>();source.Clip=new(Handles[i]);
            source.PlayOnStart=false;source.Loop=i<2;source.Streaming=false;
            // Generated properties flush after Awake; Play/Stop are immediate.
            // Start at zero so the first Tick sees an already committed mute.
            source.SpatialBlend=0;source.Volume=0;source.MixerGroup=i<2?AudioMixerGroup.Music:AudioMixerGroup.SFX;
        }
    }
    public void Cue(int index){if(index>=2&&index<sources.Length)pending[index]=true;}
    public void Tick(int song,bool paused,bool muted)
    {
        if(!initialized)
        {
            for(int i=0;i<entities.Length;i++)
            {
                if(!entities[i].IsValid)return;
                sources[i]??=entities[i].GetComponent<AudioSource>();
            }
            // Stop preserves the native voice and decoded PCM. Warm each once
            // with zero gain; restore normal volume only after Stop completes.
            for(int i=0;i<sources.Length;i++)
            {
                var source=sources[i]!;source.Play();source.Stop();
                source.Volume=muted?0:Volumes[i];
            }
            initialized=true;Log.Info("[Return] audio warmup:5 silent voices");
            Log.Info("[Return] audio backend:"+AudioSystem.BackendName);
        }
        if(wasMuted!=muted)
        {
            for(int i=0;i<sources.Length;i++)sources[i]!.Volume=muted?0:Volumes[i];
            wasMuted=muted;
        }
        if(playing!=song)
        {
            if(playing>=0){if(sources[playing]!.State!=AudioPlaybackState.Stopped)sources[playing]!.Stop();suspended[playing]=false;}
            playing=song;
            if(song>=0){sources[song]!.Play();if(paused){sources[song]!.Pause();suspended[song]=true;}}
        }
        if(paused!=wasPaused)
        {
            for(int i=0;i<sources.Length;i++)
            {
                if(paused&&sources[i]!.State==AudioPlaybackState.Playing){sources[i]!.Pause();suspended[i]=true;}
                else if(!paused&&suspended[i]){sources[i]!.Play();suspended[i]=false;}
            }
            wasPaused=paused;
        }
        if(paused)return;
        for(int i=2;i<sources.Length;i++)if(pending[i])
        {
            if(sources[i]!.State!=AudioPlaybackState.Stopped)sources[i]!.Stop();
            sources[i]!.Play();pending[i]=false;
        }
    }
    public void Stop()
    {
        for(int i=0;i<sources.Length;i++)
        {
            if(sources[i] is {} source&&source.State!=AudioPlaybackState.Stopped)source.Stop();
            pending[i]=suspended[i]=false;
        }
        playing=-1;
    }
}
