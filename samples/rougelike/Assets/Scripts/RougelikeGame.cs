using System;
using System.Collections.Generic;
using System.Globalization;
using TomCat;

namespace TomCatGame;

// All simulation, input, geometry, text and effects run inside the Tc player.
// Coordinates follow the original 1152 x 648 Godot canvas (y points down).
public sealed class RougelikeGame : MonoBehaviour
{
    const ulong Hex = 6100000000000000015UL, Circle = 6100000000000000011UL;
    const ulong Square = 6100000000000000012UL, Triangle = 6100000000000000013UL;
    const ulong MonoFont = 6100000000000000020UL, ChineseFont = 6100000000000000021UL;
    static readonly Color Ink = new(.221f, .221f, .221f), Paper = new(.9682644f, .9684492f, .8876525f);
    static readonly Color Red = new(.788f, .302f, .271f);
    static readonly Color[] CardColors = [new(.845f,.845f,.775f),new(.3f,.55f,.92f),new(.58f,.32f,.82f),new(.94f,.74f,.2f),Red,new(1,.45f,.1f),new(.06f,.06f,.07f),new(.64f,.69f,.76f)];
    enum Phase { Menu, Playing, Upgrade, Dying, Dead, Clear }
    sealed class Visual
    {
        public Entity Entity = null!;
        public Transform? Transform;
        public SpriteRenderer? Sprite;
        public TextRenderer? Label;
        public ulong Texture;
        public bool Initialized, Hidden;
        public Vector2 Position, Size = Vector2.One;
        public float Angle, FontSize, Opacity = 1, Scale = 1;
        public int Order;
        public Color Color = Ink;
        public string? Text, PreviousText;
        public Vector3 LastPosition, LastScale;
        public Color LastColor;
        public float LastAngle;
        public bool Applied, LastEnabled;
    }
    sealed class Enemy
    {
        public Visual Body = null!, Number = null!;
        public Vector2 Position;
        public float Speed, Flash;
        public int Health;
    }
    sealed class Particle
    {
        public Visual Body = null!;
        public Vector2 Velocity;
        public float Life, Total, Spin;
    }
    sealed class Slash
    {
        public Visual[] Pieces = [];
        public readonly HashSet<Enemy> Hit = [];
        public readonly HashSet<Breakable> HitControls = [];
        public Vector2[] Polygon = [];
        public float[] Jitter = [];
        public Vector2 Position;
        public float Angle, Radius, Span, Age, Direction, Width, Alpha;
        public bool Back;
    }
    sealed class Hole
    {
        public Visual Core = null!;
        public Visual[] Rings = [];
        public Vector2 Position;
        public float Age;
    }
    sealed class Blade
    {
        public Visual Body = null!;
        public Vector2 Position, Direction;
        public float Distance;
        public readonly HashSet<Enemy> Hit = [];
        public readonly HashSet<Breakable> HitControls = [];
        public Visual[] Trails = [];
        public float Fade = -1;
    }
    sealed class Breakable
    {
        public readonly List<Visual> Parts = [];
        public readonly List<Vector2> Homes = [];
        public Vector2 Center, Size;
        public float Radius, Broken, ReadyAt;
        public int Action = -1, Priority, CardIndex = -1;
        public bool Regenerates;
    }
    sealed class Shard
    {
        public readonly List<Visual> Parts = [];
        public readonly List<Vector2> Offsets = [];
        public readonly List<float> Angles = [];
        public Vector2 Start;
        public float Age, Duration, Side, Distance, Fall, Spin, Shrink = 1;
    }
    readonly Random random = new();
    readonly List<Visual> visuals = [];
    readonly List<Enemy> enemies = [];
    readonly List<Particle> particles = [];
    readonly List<Slash> slashes = [];
    readonly List<Hole> holes = [];
    readonly List<Blade> blades = [];
    readonly List<Visual> panel = [];
    readonly List<Visual> hud = [];
    readonly List<Breakable> controls = [];
    readonly List<Shard> shards = [];
    readonly List<Visual> comboFrame = [];
    readonly List<Visual> hurtEdges = [];
    readonly List<Visual> glitch = [];
    Visual player = null!, knife = null!, nose = null!, healthFill = null!, energyFill = null!;
    Visual healthLabel = null!, energyLabel = null!, waveLabel = null!, comboLabel = null!, skillLabel = null!, notice = null!, chargeLine = null!, pauseLabel = null!, tint = null!, energyTrail = null!, deathCover = null!;
    Breakable hpControl = null!, energyControl = null!, waveControl = null!, comboControl = null!;
    Camera camera = null!;
    Transform cameraTransform = null!;
    Entity? viewportEntity;
    RectTransform? viewportRect;
    RougelikeAudio audio = null!;
    Phase phase;
    UpgradeChoice[] choices = [];
    Vector2 position = new(300,470), aim = new(1,0), mouse;
    float elapsed, runTime, phaseTime, spawnTimer, cooldown, regenDelay, invulnerable, shake, comboTime, chargeTime;
    float facing, knifeTime = 1, knifeFrom, knifeTo, tripRadius = 65, tripSpan = 240*MathF.PI/180;
    float bannerTime, hurtTime, deniedTime, energyDisplay = 1, energyTrailDisplay = 1, actionDelay, comboBump, upgradeWait;
    bool atOrigin = true, swingBack, waveActive;
    int pendingAction = -1;
    float energy=100, maxEnergy=100, speed=500, attackCost=10, regen=25, attackCooldown=.05f, slashRadius=65, slashSpan=240, invulnerability=.65f;
    float slowDrain=44, slowScale=.25f, holeCost=30, holeDuration=3, holeRadius=220, chargeMaxTime=1.1f, chargeMinRange=140, chargeMaxRange=560, chargeWidth=34;
    int health=10, maxHealth=10, wave, spawned, kills, combo, rerolls=3;
    bool slowUnlocked, holeUnlocked, chargeUnlocked, slow, slowLocked, paused;
    float viewportWidth=1152, viewportHeight=648, worldHeight=648;

    void Awake()
    {
        audio=new RougelikeAudio();
        camera = World.Find("MainCamera")!.GetComponent<Camera>();
        cameraTransform = camera.Entity.GetComponent<Transform>();
        cameraTransform.Position=new(0,0,-10);
        // A stretched, non-interactive native UI rect measures the actual viewport.
        var canvas = World.CreateEntity("ViewportMetrics");
        var rootCanvas = canvas.AddComponent<Canvas>();
        rootCanvas.ScaleMode = CanvasScaleMode.ConstantPixelSize;
        viewportEntity = World.CreateEntity("ViewportRect", default, canvas);
        var rect = viewportEntity.AddComponent<RectTransform>();
        rect.AnchorMin=Vector2.Zero; rect.AnchorMax=Vector2.One; rect.SizeDelta=Vector2.Zero;
        BuildStage();
        Menu();
        Log.Info("[Rougelike] ready: Tc C# arena, 10 waves, native sprites and text");
    }

    Visual Sprite(string name, ulong texture, float x, float y, float w, float h, Color color, int order=0)
    {
        var e=World.CreateEntity(name, new Vector3(10000,10000,0));
        e.AddComponent<SpriteRenderer>();
        var v=new Visual {Entity=e,Texture=texture,Position=new(x,y),Size=new(w,h),Color=color,Order=order};
        visuals.Add(v); return v;
    }
    Visual Text(string name,string text,float x,float y,float size,Color color,bool chinese=false)
    {
        var e=World.CreateEntity(name,new Vector3(10000,10000,0));
        e.AddComponent<TextRenderer>();
        var v=new Visual {Entity=e,Text=text,Texture=chinese?ChineseFont:MonoFont,Position=new(x,y),FontSize=size,Color=color,Order=100};
        visuals.Add(v); return v;
    }
    void Remove(Visual v) { v.Entity.Destroy(); visuals.Remove(v); }
    void ClearPanel()
    {
        controls.RemoveAll(c=>c.Parts.Count>0&&panel.Contains(c.Parts[0]));
        foreach(var v in panel) Remove(v); panel.Clear();
    }
    void PanelText(string name,string text,float x,float y,float size,Color? color=null,bool chinese=true) => panel.Add(Text(name,text,x,y,size,color??Ink,chinese));
    void PanelBox(string name,float x,float y,float w,float h,Color color) => panel.Add(Sprite(name,Square,x,y,w,h,color,30));
    Breakable Register(List<Visual> parts,Vector2 center,Vector2 size,float radius,int action=-1,bool regenerates=false,int priority=0)
    {
        var c=new Breakable{Center=center,Size=size,Radius=radius,Action=action,Regenerates=regenerates,Priority=priority};
        foreach(var p in parts){c.Parts.Add(p);c.Homes.Add(p.Position);}
        controls.Add(c);return c;
    }
    Visual Line(string name,Vector2 from,Vector2 to,float width,Color color,int order)
    {
        var delta=to-from;var middle=(from+to)*.5f;
        var v=Sprite(name,Square,middle.X,middle.Y,Length(delta),width,color,order);
        v.Angle=MathF.Atan2(delta.Y,delta.X);return v;
    }
    Breakable PanelButton(string name,string label,float x,float y,float width,float height,int action,float font=50)
    {
        int first=panel.Count;
        SlantPanel(name,x,y,width,height,new(.221f,.221f,.221f,.1f),false);
        PanelText(name+" label",label,x-width*.5f+40,y-font*.35f,font);
        return Register(panel.GetRange(first,panel.Count-first),new(x,y),new(width,height),height*1.5f,action);
    }
    void SlantPanel(string name,float x,float y,float width,float height,Color color,bool border)
    {
        // Scanline tessellation preserves the source parallelogram using native sprites.
        const int rows=16;float step=height/rows;
        for(int j=0;j<rows;j++)PanelBox(name,x+9-18*(j+.5f)/rows,y-height*.5f+step*(j+.5f),width-18,step+.1f,color);
        if(!border)return;
        Vector2[] corners=[new(x-width*.5f+18,y-height*.5f),new(x+width*.5f,y-height*.5f),new(x+width*.5f-18,y+height*.5f),new(x-width*.5f,y+height*.5f)];
        for(int j=0;j<4;j++)panel.Add(Line(name+" border",corners[j],corners[(j+1)%4],3,Ink,31));
    }
    void BuildStage()
    {
        // Slight inset border, as in the original arena.
        var border=new Color(.22f,.22f,.22f,.2f);
        Sprite("ArenaTop",Square,576,1,1152,2,border,-10);
        Sprite("ArenaBottom",Square,576,647,1152,2,border,-10);
        Sprite("ArenaLeft",Square,1,324,2,648,border,-10);
        Sprite("ArenaRight",Square,1151,324,2,648,border,-10);
        // Subtle scanlines are native geometry, independent of a browser overlay.
        for(int y=1;y<648;y+=3) Sprite("CRT scanline",Square,576,y,1152,.6f,new(.1f,.1f,.1f,.035f),90);
        camera.Vignette=.35f;
        player=Sprite("Player",Hex,300,470,52,52,Ink,50);
        knife=Sprite("Knife",Square,340,470,5,28,Ink,52);
        nose=Sprite("Aim",Triangle,332,470,8,8,Ink,51);
        chargeLine=Sprite("Charge guide",Square,0,0,1,2,new(.5f,.55f,.6f,.6f),10); chargeLine.Hidden=true;
        tint=Sprite("Hurt and time tint",Square,576,324,1152,648,new(1,0,0,0),95);
        hud.Add(Sprite("HP track",Square,154,32,260,20,new(.22f,.22f,.22f,.16f),25));
        healthFill=Sprite("Health",Square,154,32,254,14,Alpha(Red,.855f),26);hud.Add(healthFill);
        healthLabel=Text("Health value","10 / 10",316,24,28,Ink);hud.Add(healthLabel);
        hpControl=Register(hud.GetRange(0,3),new(154,32),new(260,20),65,regenerates:true);
        int first=hud.Count;
        hud.Add(Sprite("Energy track",Square,154,56,260,16,new(.22f,.22f,.22f,.16f),25));
        energyTrail=Sprite("Energy trail",Square,154,56,254,10,new(.62f,.8f,1,.85f),26);hud.Add(energyTrail);
        energyFill=Sprite("Energy",Square,154,56,254,10,new(.3f,.55f,.92f),27);hud.Add(energyFill);
        energyLabel=Text("Energy value","",316,50,20,Ink);hud.Add(energyLabel);
        energyControl=Register(hud.GetRange(first,hud.Count-first),new(154,56),new(260,16),65,regenerates:true);
        waveLabel=Text("Wave","",456,52,40,Ink);hud.Add(waveLabel);
        waveControl=Register([waveLabel],new(576,64),new(440,40),110,regenerates:true);
        first=hud.Count;
        for(int side=-1;side<=1;side+=2)
        {
            Vector2[] points=[new(576,502),new(576+side*132,502),new(576+side*150,541),new(576+side*132,580),new(576,580)];
            for(int j=0;j<4;j++){var line=Line("Combo frame",points[j],points[j+1],3,Red,35);comboFrame.Add(line);hud.Add(line);}
        }
        comboLabel=Text("Combo","",558,522,56,Red);hud.Add(comboLabel);
        hud.Add(Text("Combo tag","COMBO",536,602,30,Ink));
        comboControl=Register(hud.GetRange(first,hud.Count-first),new(576,541),new(360,110),90,regenerates:true);
        skillLabel=Text("Skills","",40,620,20,Ink,true);hud.Add(skillLabel);
        notice=Text("Notice","",380,135,25,Ink,true);hud.Add(notice);
        pauseLabel=Text("Pause","",430,310,48,Ink,true);
        deathCover=Sprite("Death black",Square,576,324,1152,648,new(0,0,0,0),200);
        for(int i=0;i<12;i++)
        {
            float inset=i*7,alpha=(1-i/12f)*.025f;
            hurtEdges.Add(Sprite("Hurt edge",Square,inset+3.5f,324,7,648,new(Red.R,Red.G,Red.B,alpha),95));
            hurtEdges.Add(Sprite("Hurt edge",Square,1148.5f-inset,324,7,648,new(Red.R,Red.G,Red.B,alpha),95));
            hurtEdges.Add(Sprite("Hurt edge",Square,576,inset+3.5f,1152,7,new(Red.R,Red.G,Red.B,alpha),95));
            hurtEdges.Add(Sprite("Hurt edge",Square,576,644.5f-inset,1152,7,new(Red.R,Red.G,Red.B,alpha),95));
        }
        for(int i=0;i<12;i++)glitch.Add(Sprite("Death tear",Square,576,i*54,1152,2,new(0,0,0,0),190));
    }
    void Menu()
    {
        ClearWorld(); ClearPanel(); phase=Phase.Menu; phaseTime=0; paused=false;
        ResetPlayer();position=new(300,470);
        PanelText("Title","ROUGELIKE",120,275,72,Ink,false);
        Register([panel[0]],new(410,300),new(580,100),145,regenerates:true);
        PanelButton("Start","开始游戏",908,357,330,80,0,56);
        PanelButton("Exit","退出游戏",908,485,330,80,2,56);
        PanelText("Menu hint","走近按钮，挥刀打碎它",120,395,26);
        PanelText("Keyboard start","或按 ENTER 开始",120,435,24);
        PanelText("Menu controls","WASD 移动   ·   鼠标瞄准   ·   左键前斩 / 右键背斩",120,565,26);
        PanelText("Menu footer","十波生存 / 随机强化 / 用刀选择一切",120,605,24);
        Log.Info("[Rougelike] menu");
    }
    void Begin()
    {
        ClearPanel();ClearWorld();
        ResetPlayer();runTime=0;kills=combo=0;rerolls=3;
        position=new(576,324);wave=0;StartWave(1.5f);
    }
    void ResetPlayer()
    {
        maxHealth=health=10; maxEnergy=energy=100;speed=500;attackCost=10;regen=25;attackCooldown=.05f;slashRadius=65;slashSpan=240;invulnerability=.65f;
        slowDrain=44;slowScale=.25f;holeCost=30;holeDuration=3;holeRadius=220;chargeMaxTime=1.1f;chargeMinRange=140;chargeMaxRange=560;chargeWidth=34;
        slowUnlocked=holeUnlocked=chargeUnlocked=slow=slowLocked=paused=false;
        cooldown=regenDelay=invulnerable=chargeTime=comboTime=hurtTime=deniedTime=0;combo=0;
        facing=0;aim=new(1,0);atOrigin=true;swingBack=false;tripRadius=65;tripSpan=240*MathF.PI/180;knifeFrom=knifeTo=tripSpan*.5f;knifeTime=1;
        energyDisplay=energyTrailDisplay=1;pendingAction=-1;actionDelay=0;
        player.Hidden=knife.Hidden=nose.Hidden=false;
        foreach(var c in controls){c.Broken=0;foreach(var p in c.Parts){p.Opacity=1;p.Scale=1;}}
    }
    void StartWave(float delay)
    {
        phase=Phase.Playing;phaseTime=0;spawned=0;spawnTimer=delay;waveActive=false;
        notice.Text="";bannerTime=0;
    }
    void ClearWorld()
    {
        foreach(var e in enemies){Remove(e.Body);Remove(e.Number);}enemies.Clear();
        foreach(var p in particles)Remove(p.Body);particles.Clear();
        foreach(var s in slashes)foreach(var v in s.Pieces)Remove(v);slashes.Clear();
        foreach(var h in holes){Remove(h.Core);foreach(var v in h.Rings)Remove(v);}holes.Clear();
        foreach(var b in blades){Remove(b.Body);foreach(var v in b.Trails)Remove(v);}blades.Clear();
        foreach(var shard in shards)foreach(var part in shard.Parts)Remove(part);shards.Clear();
    }
    void Update()
    {
        var dt=Math.Clamp(Time.DeltaTime,0,.05f);
        if(viewportEntity is {IsValid:true})viewportRect??=viewportEntity.GetComponent<RectTransform>();
        if(viewportRect is not null){var r=viewportRect.RuntimeRect;if(r.Height>0){viewportWidth=r.Width;viewportHeight=r.Height;}}
        worldHeight=Math.Max(648,1152*viewportHeight/Math.Max(viewportWidth,1));
        camera.OrthographicSize=worldHeight;
        mouse=new(576+(Input.MousePosition.X-viewportWidth*.5f)*worldHeight/viewportHeight,324+(Input.MousePosition.Y-viewportHeight*.5f)*worldHeight/viewportHeight);
        if(Input.WasKeyPressed(KeyCode.P)&&phase is Phase.Playing or Phase.Upgrade) paused=!paused;
        // Losing focus cannot leave the player taking damage in the background.
        if(!Input.IsWindowFocused&&phase==Phase.Playing)paused=true;
        pauseLabel.Text=paused?"已暂停 · 按 P 继续":"";
        if(!paused)
        {
            elapsed+=dt;phaseTime+=dt;cooldown=Math.Max(0,cooldown-dt);invulnerable=Math.Max(0,invulnerable-dt);
            knifeTime+=dt;hurtTime=Math.Max(0,hurtTime-dt);deniedTime=Math.Max(0,deniedTime-dt);bannerTime=Math.Max(0,bannerTime-dt);comboBump=Math.Max(0,comboBump-dt);
            if(phase!=Phase.Dying)Move(dt);
            if(phase==Phase.Menu&&Input.WasKeyPressed(KeyCode.Enter))Begin();
            else if(phase is Phase.Dead or Phase.Clear)
            {
                if(Input.WasKeyPressed(KeyCode.Enter))Begin();
                else if(Input.WasKeyPressed(KeyCode.M))Menu();
            }
            if(phase==Phase.Upgrade)
            {
                if(Input.WasKeyPressed(KeyCode.Alpha1))Choose(0);
                else if(Input.WasKeyPressed(KeyCode.Alpha2))Choose(1);
                else if(Input.WasKeyPressed(KeyCode.Alpha3))Choose(2);
                else if(Input.WasKeyPressed(KeyCode.E)&&rerolls>0){rerolls--;Deal();}
            }
            if(phase!=Phase.Dying)
            {
                UpdateEnergy(dt);
                if(holeUnlocked&&Input.WasKeyPressed(KeyCode.R)&&Spend(holeCost))CreateHole();
                if(Input.WasMouseButtonPressed(MouseButton.Left))Attack(false);
                else if(Input.WasMouseButtonPressed(MouseButton.Right))Attack(true);
                Charge(dt);
            }
            float worldDt=dt*(slow?slowScale:1);
            TickHoles(worldDt);TickBlades(dt);
            if(phase==Phase.Playing)
            {
                runTime+=dt;
                TickEnemies(worldDt,dt);
                spawnTimer-=worldDt;
                if(phase==Phase.Playing&&spawned<RougelikeRules.WaveCounts[wave]&&spawnTimer<=0)
                {
                    if(!waveActive){waveActive=true;bannerTime=1.83f;waveLabel.Text=$"WAVE {wave+1} / 10";Log.Info($"[Rougelike] wave:{wave+1} enemies:{RougelikeRules.WaveCounts[wave]} hp:{RougelikeRules.WaveHealth[wave]}");}
                    Spawn();spawnTimer+=.5f;
                }
                if(phase==Phase.Playing&&spawned==RougelikeRules.WaveCounts[wave]&&enemies.Count==0){if(wave==9)Finish(true);else Deal();}
            }
            if(phase==Phase.Upgrade){upgradeWait+=worldDt;if(upgradeWait>=60){ClearPanel();wave++;StartWave(3);}}
            if(phase==Phase.Dying&&phaseTime>=2.32f)GameOver();
            TickSlashes(dt);TickParticles(dt);TickShards(dt);TickControls(dt);
            if(pendingAction>=0){actionDelay-=dt;if(actionDelay<=0)PerformAction();}
            comboTime-=dt;if(comboTime<=0)combo=0;
            shake=Math.Max(0,shake-dt*35);
        }
        float pitch=phase==Phase.Dying?1-.98f*MathF.Pow(Math.Clamp(phaseTime/2.6f,0,1),2):slow?slowScale:1;
        audio.Tick(phase is Phase.Playing or Phase.Upgrade or Phase.Dying or Phase.Clear,paused,pitch);
        Render();
        Flush();
    }
    void OnDestroy() => audio?.Stop();
    void Move(float dt)
    {
        var direction=new Vector2((Input.IsKeyHeld(KeyCode.D)?1:0)-(Input.IsKeyHeld(KeyCode.A)?1:0),(Input.IsKeyHeld(KeyCode.S)?1:0)-(Input.IsKeyHeld(KeyCode.W)?1:0));
        position+=Normal(direction)*speed*dt;
        position.X=Math.Clamp(position.X,25,1127);position.Y=Math.Clamp(position.Y,25,623);
        if(Length(mouse-position)>6)aim=Normal(mouse-position);
        facing+=Wrap(MathF.Atan2(aim.Y,aim.X)-facing)*(1-MathF.Exp(-10*dt));
    }
    bool Spend(float amount)
    {
        if(energy<amount){notice.Text="能量不足";deniedTime=.24f;return false;}
        energy-=amount;regenDelay=.25f;return true;
    }
    void UpdateEnergy(float dt)
    {
        bool held=Input.IsKeyHeld(KeyCode.LeftShift)||Input.IsKeyHeld(KeyCode.RightShift);
        if(!held)slowLocked=false;
        slow=slowUnlocked&&held&&!slowLocked&&(slow?energy>0:energy>=5);
        if(slow){energy=Math.Max(0,energy-slowDrain*dt);if(energy<=0){slowLocked=true;slow=false;}}
        if(regenDelay>0)regenDelay-=dt;
        else energy=Math.Min(maxEnergy,energy+regen*dt*(slow?slowScale:1));
    }
    void Attack(bool back)
    {
        if(cooldown>0||!Spend(attackCost))return;
        audio.Cue(1);
        cooldown=attackCooldown;
        if(back!=swingBack){swingBack=back;atOrigin=true;}
        if(atOrigin){tripRadius=slashRadius*Range(.94f,1.08f);tripSpan=slashSpan*MathF.PI/180*Range(.9f,1.12f);}
        float sign=atOrigin?-1:1;
        knifeFrom=-tripSpan*.5f*sign+(back?MathF.PI:0);knifeTo=knifeFrom+tripSpan*sign;knifeTime=0;atOrigin=!atOrigin;
        int segments=random.Next(3,7);
        var s=new Slash{Position=position,Angle=facing+(back?MathF.PI:0),Radius=tripRadius,Span=tripSpan,Direction=sign,Back=back,Width=52*Range(.86f,1.14f),Alpha=Range(.82f,1.18f),Jitter=new float[segments+1]};
        for(int i=0;i<s.Jitter.Length;i++)s.Jitter[i]=Range(-1,1);
        s.Pieces=new Visual[30];
        for(int i=0;i<s.Pieces.Length;i++)s.Pieces[i]=Sprite("Slash arc",Square,position.X,position.Y,1,1,Ink,48);
        slashes.Add(s);shake=Math.Max(shake,4);
    }
    void CheckControls(Func<Vector2,float,bool> touches,HashSet<Breakable> hit)
    {
        var targets=controls.ToArray();Array.Sort(targets,(a,b)=>b.Priority.CompareTo(a.Priority));
        foreach(var c in targets)
        {
            if(c.Broken>0||phaseTime<c.ReadyAt||hit.Contains(c)||c.Parts.Count==0||c.Parts[0].Hidden||c.Parts[0].Opacity<.05f||c.Parts[0].Color.A<.05f)continue;
            if(c.Action>=0&&pendingAction>=0)continue;
            if(!touches(c.Center,c.Radius))continue;
            hit.Add(c);BreakControl(c);
        }
    }
    void Spawn()
    {
        int side=random.Next(4);var p=side switch{0=>new Vector2(-40,Range(0,648)),1=>new Vector2(1192,Range(0,648)),2=>new Vector2(Range(0,1152),-40),_=>new Vector2(Range(0,1152),688)};
        var e=new Enemy{Position=p,Speed=Range(50,150),Health=RougelikeRules.WaveHealth[wave]};
        e.Body=Sprite("Enemy",Circle,p.X,p.Y,51.26f,51.26f,Ink,20);
        e.Number=Text("Enemy health","",p.X-11,p.Y-17,46,Ink);
        enemies.Add(e);spawned++;
    }
    void TickEnemies(float dt,float realDt)
    {
        foreach(var e in enemies)
        {
            e.Flash=Math.Max(0,e.Flash-realDt);
            bool overlap=Length(e.Position-position)<50.63f;
            if(!overlap)
            {
                var push=Vector2.Zero;
                foreach(var other in enemies)
                {
                    if(other==e)continue;var d=e.Position-other.Position;float distance=Length(d);
                    if(distance>=46)continue;if(distance<.0001f){d=Direction(enemies.IndexOf(e)*1.7f);distance=.0001f;}
                    push+=Normal(d)*(1-distance/46);
                }
                e.Position+=(Normal(position-e.Position)*e.Speed+Normal(push)*90)*dt;
            }
            e.Body.Position=e.Position;e.Body.Color=e.Flash>0?Mix(Ink,Paper,Math.Clamp(e.Flash/.15f,0,1)):Ink;
            e.Number.Position=e.Position+new Vector2(-11,-17);e.Number.Text=e.Flash>0?e.Health.ToString():"";
            e.Number.Opacity=Math.Clamp(e.Flash/.1f,0,1);
            if(overlap&&invulnerable<=0){Hurt();if(phase==Phase.Dying)break;}
        }
    }
    void Hurt()
    {
        health--;invulnerable=invulnerability;shake=9;hurtTime=.34f;
        audio.Cue(4);
        Burst(position,Red,10);Log.Info($"[Rougelike] hurt hp:{health}");
        if(health<=0)Finish(false);
    }
    void Hit(Enemy e, Vector2 direction)
    {
        e.Health--;e.Flash=.2f;
        audio.Cue(e.Health>0?2:3);
        Chips(e.Position,direction);
        if(e.Health>0)return;
        Burst(e.Position,Alpha(Ink,.4f),16);SplitShape(e.Position,25.63f,false,Ink);Remove(e.Body);Remove(e.Number);enemies.Remove(e);
        kills++;combo++;comboTime=1.6f;comboBump=.11f;shake=Math.Max(shake,4);
        Log.Info($"[Rougelike] kill:{kills} remaining:{enemies.Count}");
    }
    void TickSlashes(float dt)
    {
        for(int n=slashes.Count-1;n>=0;n--)
        {
            var s=slashes[n];s.Age+=dt;
            if(s.Age>.22f){foreach(var v in s.Pieces)Remove(v);slashes.RemoveAt(n);continue;}
            float fraction=EaseQuint(Math.Min(1,s.Age/.09f));float fade=Math.Clamp((s.Age-.12f)/.1f,0,1);
            float k=Math.Min(1,s.Age/.09f),rigScale=s.Age<.09f?.9f+.15f*k:s.Age<.12f?1.05f-.05f*(s.Age-.09f)/.03f:1+.06f*fade;
            float radius=s.Radius*(s.Age<.09f?.92f+.08f*k:1+.02f*fade)*rigScale;
            float width=s.Width*(s.Age<.09f?.7f+.3f*k:1-.15f*fade)*rigScale;
            s.Position=position+Direction(facing+(s.Back?MathF.PI:0))*5*fade;
            s.Angle=facing+(s.Back?MathF.PI:0)+MathF.PI/30*s.Direction*fade;
            float from=-s.Span*.5f*s.Direction,to=from+s.Span*s.Direction*fraction;
            int count=s.Jitter.Length;s.Polygon=new Vector2[count*2];
            for(int i=0;i<count;i++)
            {
                float t=i/(float)(count-1),a=from+(to-from)*t,shape=1+s.Jitter[i]*.12f;
                s.Polygon[i]=Direction(a)*(radius+width*.5f)*shape;
                s.Polygon[count*2-1-i]=Direction(a)*Math.Max(0,radius-width*.5f)*shape;
            }
            float alpha=.3f*s.Alpha*MathF.Pow(1-fade,1.15f)*(s.Age>=.09f&&s.Age<.12f?1+.45f*MathF.Sin((s.Age-.09f)/.03f*MathF.PI):1);
            for(int i=0;i<s.Pieces.Length;i++)
            {
                float t=(i+.5f)/s.Pieces.Length,segment=t*(count-1);int j=Math.Min(count-2,(int)segment);float between=segment-j;
                Vector2 outer=s.Polygon[j]+(s.Polygon[j+1]-s.Polygon[j])*between;
                Vector2 inner=s.Polygon[count*2-1-j]+(s.Polygon[count*2-2-j]-s.Polygon[count*2-1-j])*between;
                var v=s.Pieces[i];var mid=(outer+inner)*.5f;v.Hidden=fraction<.005f;
                v.Position=s.Position+Rotate(mid,s.Angle);v.Angle=s.Angle+MathF.Atan2((outer-inner).Y,(outer-inner).X)+MathF.PI*.5f;
                v.Size=new(Math.Max(.1f,radius*s.Span*fraction/s.Pieces.Length+.5f),Length(outer-inner));v.Color=new(0,0,0,alpha);
            }
            if(phase==Phase.Dying||s.Age>.12f||fraction<.005f)continue;
            CheckControls((at,r)=>CirclePolygon(Rotate(at-s.Position,-s.Angle),r,s.Polygon),s.HitControls);
            if(phase!=Phase.Playing)continue;
            foreach(var e in enemies.ToArray())
            {
                var delta=e.Position-s.Position;
                if(CirclePolygon(Rotate(delta,-s.Angle),25.63f,s.Polygon)&&s.Hit.Add(e))Hit(e,Normal(delta));
            }
        }
    }
    void Charge(float dt)
    {
        chargeLine.Hidden=true;
        if(!chargeUnlocked||phase==Phase.Dying){chargeTime=0;return;}
        if(Input.IsMouseButtonHeld(MouseButton.Left))
        {
            chargeTime+=dt;
            if(chargeTime>.25f){float distance=ChargeDistance();chargeLine.Hidden=false;chargeLine.Position=position+aim*(distance*.5f);chargeLine.Size=new(distance,2);chargeLine.Angle=MathF.Atan2(aim.Y,aim.X);}
        }
        else
        {
            if(chargeTime>=.25f)
            {
                var b=new Blade{Position=position,Direction=aim,Distance=ChargeDistance(),Body=Sprite("Charge slash",Hex,position.X,position.Y,96,Math.Max(chargeWidth,8),new(.86f,.88f,.93f,.6f),45),Trails=new Visual[3]};
                b.Body.Angle=MathF.Atan2(aim.Y,aim.X);blades.Add(b);shake=6;
                for(int j=0;j<3;j++)b.Trails[j]=Sprite("Charge trail",Hex,position.X,position.Y,96*(1+(j+1)*.225f),Math.Max(chargeWidth,8)*(1+(j+1)*.225f),new(.86f,.88f,.93f,.6f*(1-(j+1)*.25f)*.5f),44);
                Log.Info("[Rougelike] charge released");
            }
            chargeTime=0;
        }
    }
    float ChargeDistance()=>chargeMinRange+(chargeMaxRange-chargeMinRange)*Math.Clamp((chargeTime-.25f)/chargeMaxTime,0,1);
    void TickBlades(float dt)
    {
        for(int i=blades.Count-1;i>=0;i--)
        {
            var b=blades[i];
            if(b.Fade>=0)
            {
                b.Fade+=dt;b.Body.Opacity=Math.Max(0,1-b.Fade/.16f);b.Body.Scale=1+.35f*b.Fade/.16f;
                foreach(var v in b.Trails)v.Opacity=b.Body.Opacity;
                if(b.Fade>=.16f){Remove(b.Body);foreach(var v in b.Trails)Remove(v);blades.RemoveAt(i);}continue;
            }
            float travel=Math.Min(b.Distance,1600*dt);var previous=b.Position;b.Position+=b.Direction*travel;b.Distance-=travel;b.Body.Position=b.Position;
            for(int j=0;j<3;j++){b.Trails[j].Position=b.Position-b.Direction*96*(j+1)*.25f*.55f;b.Trails[j].Angle=b.Body.Angle;}
            bool Touches(Vector2 at,float radius){var offset=at-previous;float along=Math.Clamp(Dot(offset,b.Direction),0,travel);return Length(at-(previous+b.Direction*along))<chargeWidth+radius;}
            CheckControls(Touches,b.HitControls);
            foreach(var e in enemies.ToArray())if(Touches(e.Position,25.63f)&&b.Hit.Add(e))Hit(e,b.Direction);
            if(b.Distance<=0)b.Fade=0;
        }
    }
    void CreateHole()
    {
        audio.Cue(5);
        var h=new Hole{Position=new(Math.Clamp(mouse.X,0,1152),Math.Clamp(mouse.Y,0,648))};
        h.Core=Sprite("Black hole",Hex,h.Position.X,h.Position.Y,52,52,new(.03f,.03f,.04f),15);
        h.Rings=new Visual[15];for(int i=0;i<15;i++)h.Rings[i]=Sprite("Gravity ring",Square,0,0,1,1,Ink,14);
        holes.Add(h);Log.Info("[Rougelike] black hole");
    }
    void TickHoles(float dt)
    {
        for(int i=holes.Count-1;i>=0;i--)
        {
            var h=holes[i];h.Age+=dt;
            if(h.Age>=holeDuration+.22f){Remove(h.Core);foreach(var v in h.Rings)Remove(v);holes.RemoveAt(i);continue;}
            float envelope=(.25f+.75f*Math.Min(1,h.Age/.18f))*Math.Clamp((holeDuration+.22f-h.Age)/.22f,0,1);
            h.Core.Scale=envelope;int at=0;
            for(int ring=0;ring<3;ring++)
            {
                int count=4+ring;float radius=46*(1+ring*.38f)*envelope,spin=h.Age*MathF.Tau*.35f*(ring%2==0?1:-1)*(1-ring*.28f);
                for(int j=0;j<count;j++)
                {
                    Vector2 a=h.Position+Direction(spin+j*MathF.Tau/count)*radius,b=h.Position+Direction(spin+(j+1)*MathF.Tau/count)*radius;
                    var v=h.Rings[at++];v.Position=(a+b)*.5f;v.Angle=MathF.Atan2((b-a).Y,(b-a).X);v.Size=new(Length(b-a),3*(1-ring*.28f));v.Color=new(.16f,.16f,.18f,.8f*(1-ring*.28f)*envelope);
                }
            }
            if(h.Age>=holeDuration)continue;
            foreach(var e in enemies){var d=h.Position-e.Position;float distance=Length(d);if(distance>0&&distance<holeRadius){e.Position+=Normal(d)*(320*(1-distance/holeRadius)*dt);e.Body.Position=e.Position;}}
        }
    }
    void Burst(Vector2 at,Color color,int count)
    {
        for(int i=0;i<count&&particles.Count<160;i++)
        {
            float life=Range(.3f,.7f),size=Range(3,9);
            particles.Add(new Particle{Body=Sprite("Fragment",Triangle,at.X,at.Y,size,size,color,55),Velocity=Direction(Range(-MathF.PI,MathF.PI))*Range(60,290),Life=life,Total=life,Spin=Range(-10,10)});
        }
    }
    void Chips(Vector2 at,Vector2 outward)
    {
        float angle=MathF.Atan2(outward.Y,outward.X);
        for(int i=0;i<10&&particles.Count<240;i++)
        {
            float a=angle+Range(-MathF.PI*.25f,MathF.PI*.25f),size=Range(2.5f,5);
            var body=Sprite("Hit chip",Triangle,at.X,at.Y,size*Range(2.8f,6.5f),size,new(0,0,0,.42f),55);body.Angle=a;
            particles.Add(new Particle{Body=body,Velocity=Direction(a)*Range(560,1150),Life=.34f,Total=.34f,Spin=0});
        }
    }
    void SplitShape(Vector2 center,float radius,bool hex,Color color)
    {
        for(int side=-1;side<=1;side+=2)
        {
            var shard=new Shard{Start=center,Side=side,Duration=.5f,Distance=72,Fall=240,Spin=55*MathF.PI/180,Shrink=.72f};
            const int rows=18;float height=hex?radius*MathF.Sqrt(3):radius*2,step=height/rows;
            for(int j=0;j<rows;j++)
            {
                float y=-height*.5f+(j+.5f)*step;
                float extent=hex?radius-MathF.Abs(y)/MathF.Sqrt(3):MathF.Sqrt(Math.Max(0,radius*radius-y*y));
                var offset=new Vector2(side*extent*.5f,y);
                shard.Parts.Add(Sprite("Split half",Square,center.X+offset.X,center.Y+offset.Y,extent,step+.15f,color,55));shard.Offsets.Add(offset);shard.Angles.Add(0);
            }
            shards.Add(shard);
        }
    }
    void SplitControl(Breakable c)
    {
        for(int side=-1;side<=1;side+=2)
        {
            var shard=new Shard{Start=c.Center,Side=side,Duration=c.Regenerates?.85f:.42f,Distance=c.Regenerates?110:72,Fall=c.Regenerates?360:240,Spin=(c.Regenerates?38:55)*MathF.PI/180};
            foreach(var source in c.Parts)
            {
                if(source.Hidden)continue;
                Visual? copy=null;
                if(source.Text is not null)
                {
                    if(source.Text.Length==0)continue;
                    float advance=source.FontSize*(source.Texture==ChineseFont?.54f:.45f);
                    int cut=Math.Clamp((int)MathF.Ceiling((c.Center.X-source.Position.X)/Math.Max(advance,1)),0,source.Text.Length);
                    string text=side<0?source.Text[..cut]:source.Text[cut..];if(text.Length==0)continue;
                    copy=Text("Text shard",text,source.Position.X+(side>0?cut*advance:0),source.Position.Y,source.FontSize,source.Color,source.Texture==ChineseFont);
                }
                else
                {
                    float left=source.Position.X-source.Size.X*.5f,right=source.Position.X+source.Size.X*.5f;
                    if(side<0)right=Math.Min(right,c.Center.X);else left=Math.Max(left,c.Center.X);
                    if(right<=left)continue;
                    copy=Sprite("UI half",source.Texture,(left+right)*.5f,source.Position.Y,right-left,source.Size.Y,source.Color,source.Order+2);copy.Angle=source.Angle;
                }
                shard.Parts.Add(copy);shard.Offsets.Add(copy.Position-c.Center);shard.Angles.Add(copy.Angle);
            }
            if(shard.Parts.Count>0)shards.Add(shard);
        }
    }
    void BreakControl(Breakable c)
    {
        SplitControl(c);c.Broken=c.Regenerates?1.95f:999;
        foreach(var p in c.Parts)p.Opacity=0;
        if(c.Action<0)return;
        if(c.Action==20&&rerolls<=0)return;
        Burst(c.Center,c.CardIndex>=0?CardColors[choices[c.CardIndex].Rarity]:Alpha(Ink,.4f),c.CardIndex>=0?20:16);
        pendingAction=c.Action;actionDelay=c.Action is 0 or 1 or 2?.5f:.05f;
    }
    void PerformAction()
    {
        int action=pendingAction;pendingAction=-1;
        if(action==0)Begin();
        else if(action==1)Menu();
        else if(action==2)
        {
            // A web player cannot close its host tab. The host retains its back button.
            ClearPanel();PanelText("Exit hint","试玩已结束",400,260,56);
            PanelText("Exit navigation","使用页面的返回按钮离开，或按 ENTER 重新开始",240,340,26);
            Log.Info("[Rougelike] exit requested");
        }
        else if(action>=10&&action<13)Choose(action-10);
        else if(action==20&&phase==Phase.Upgrade&&rerolls>0){rerolls--;Deal();}
    }
    void TickControls(float dt)
    {
        foreach(var c in controls)
        {
            if(c.Broken>0&&c.Regenerates)
            {
                c.Broken=Math.Max(0,c.Broken-dt);
                float restore=Math.Clamp(1-c.Broken/.35f,0,1);
                foreach(var p in c.Parts){p.Opacity=restore;p.Scale=.55f+.45f*EaseQuint(restore);}
            }
            if(c.CardIndex<0||c.Broken>0)continue;
            float deal=Math.Clamp((phaseTime-.16f-c.CardIndex*.07f)/.34f,0,1),scale=.55f+.45f*EaseQuint(deal);
            float bob=deal>=1?MathF.Sin(elapsed*MathF.Tau*.9f+c.CardIndex*2)*(2+choices[c.CardIndex].Rarity*.875f):0;
            Vector2 center=new(576+(256+c.CardIndex*320-576)*EaseQuint(deal),264+bob);c.Center=center;
            for(int j=0;j<c.Parts.Count;j++)
            {
                var p=c.Parts[j];p.Position=center+(c.Homes[j]-new Vector2(256+c.CardIndex*320,264))*scale;p.Scale=scale;p.Opacity=Math.Min(1,deal/.55f);
            }
        }
    }
    void TickShards(float dt)
    {
        for(int i=shards.Count-1;i>=0;i--)
        {
            var s=shards[i];s.Age+=dt;float t=Math.Clamp(s.Age/s.Duration,0,1);
            if(t>=1){foreach(var p in s.Parts)Remove(p);shards.RemoveAt(i);continue;}
            float angle=s.Side*s.Spin*Math.Min(1,s.Age/.2f),scale=1+(s.Shrink-1)*t;
            Vector2 at=s.Start+new Vector2(s.Side*s.Distance*(1-(1-t)*(1-t)),-s.Distance*.35f+(s.Fall+s.Distance*.35f)*t*t);
            for(int j=0;j<s.Parts.Count;j++){var p=s.Parts[j];p.Position=at+Rotate(s.Offsets[j]*scale,angle);p.Angle=s.Angles[j]+angle;p.Opacity=1-t;p.Scale=scale;}
        }
    }
    void TickParticles(float dt)
    {
        for(int i=particles.Count-1;i>=0;i--)
        {
            var p=particles[i];p.Life-=dt;if(p.Life<=0){Remove(p.Body);particles.RemoveAt(i);continue;}
            p.Body.Position+=p.Velocity*dt;p.Velocity*=Math.Max(0,1-dt*3);p.Body.Angle+=p.Spin*dt;p.Body.Color=Alpha(p.Body.Color,p.Life/p.Total);
        }
    }
    void Deal()
    {
        ClearPanel();phase=Phase.Upgrade;phaseTime=0;upgradeWait=0;
        choices=new UpgradeChoice[3];
        PanelBox("Upgrade dim",576,324,1152,648,new(.05f,.05f,.05f,.15f));panel[^1].Order=5;
        PanelText("Upgrade hint","挥刀打碎一张卡片，选择强化",390,135,28);
        for(int i=0;i<3;i++)
        {
            var c=RougelikeRules.Roll(random,wave+1,slowUnlocked,holeUnlocked,chargeUnlocked);choices[i]=c;
            float x=256+i*320;var fill=CardColors[c.Rarity];var ink=(.2126f*fill.R+.7152f*fill.G+.0722f*fill.B)>.55f?new Color(.16f,.16f,.16f):Paper;
            int first=panel.Count;
            if(c.Rarity>0){SlantPanel("Card glow",x,264,294,164,Alpha(fill,.24f),false);foreach(var v in panel.GetRange(first,panel.Count-first))v.Order=28;}
            SlantPanel("Upgrade card",x,264,280,150,Alpha(fill,c.Rarity==6?.96f:.92f),true);
            string title=RougelikeRules.Names[(int)c.Stat],description=RougelikeRules.Describe(c);
            float titleSize=Math.Min(40,240/Math.Max(1,title.Length)*1.6f),descSize=Math.Min(32,240/Math.Max(1,description.Length)*1.6f);
            PanelText("Upgrade name",title,x-title.Length*titleSize*.27f,225,titleSize,Alpha(ink,.78f));
            PanelText("Upgrade description",description,x-description.Length*descSize*.27f,285,descSize,ink);
            var card=Register(panel.GetRange(first,panel.Count-first),new(x,264),new(280,150),75,10+i,priority:100);card.CardIndex=i;card.ReadyAt=.16f+i*.07f+.34f;
        }
        PanelText("Upgrade keyboard","也可按 1 / 2 / 3 选择",390,380,25);
        if(rerolls>0)
        {
            var reroll=PanelButton("Reroll",$"覆写 {rerolls}",998,572,220,64,20,50);reroll.Priority=10;
            PanelText("Reroll keyboard","挥刀或按 E 重抽",865,620,20);
        }
        Log.Info($"[Rougelike] upgrade wave:{wave+1} choices:{choices[0].Stat},{choices[1].Stat},{choices[2].Stat} rerolls:{rerolls}");
    }
    void Choose(int index)
    {
        if(!PrepareChoice())return;
        var c=choices[index];Apply(c);
        Log.Info($"[Rougelike] chosen:{c.Stat} rarity:{c.Rarity}");
        Burst(new(256+index*320,264),CardColors[c.Rarity],30);ClearPanel();wave++;StartWave(3);
    }
    private bool PrepareChoice()
    {
        if(phase!=Phase.Upgrade||choices.Length!=3)return false;
        // Keyboard selection can arrive during a sliced control's short delay.
        // Cancel that old action before the next wave starts.
        pendingAction=-1;actionDelay=0;
        return true;
    }
    private void Apply(UpgradeChoice c)
    {
        float a=c.Amount;
        switch(c.Stat)
        {
            case UpgradeStat.MaxHealth: int gain=(int)MathF.Round(a,MidpointRounding.AwayFromZero);maxHealth+=gain;health=Math.Min(maxHealth,health+gain);break;
            case UpgradeStat.Heal:health=Math.Min(maxHealth,health+(int)MathF.Round(a,MidpointRounding.AwayFromZero));break;
            case UpgradeStat.MoveSpeed:speed+=a;break;
            case UpgradeStat.AttackCooldown:attackCooldown=Math.Max(.01f,attackCooldown+a);break;
            case UpgradeStat.SlashRadius:slashRadius+=a;break;
            case UpgradeStat.SlashSpan:slashSpan=Math.Min(360,slashSpan+a);break;
            case UpgradeStat.Invulnerability:invulnerability+=a;break;
            case UpgradeStat.MaxEnergy:maxEnergy+=a;energy+=a;break;
            case UpgradeStat.EnergyRegen:regen+=a;break;
            case UpgradeStat.AttackCost:attackCost=Math.Max(1,attackCost+a);break;
            case UpgradeStat.UnlockSlow:slowUnlocked=true;break;
            case UpgradeStat.SlowDrain:slowDrain=Math.Max(2,slowDrain+a);break;
            case UpgradeStat.SlowDepth:slowScale=Math.Max(.05f,slowScale+a);break;
            case UpgradeStat.UnlockBlackHole:holeUnlocked=true;break;
            case UpgradeStat.BlackHoleCost:holeCost=Math.Max(5,holeCost+a);break;
            case UpgradeStat.BlackHoleDuration:holeDuration+=a;break;
            case UpgradeStat.BlackHoleRadius:holeRadius+=a;break;
            case UpgradeStat.UnlockCharge:chargeUnlocked=true;break;
            case UpgradeStat.ChargeFaster:chargeMaxTime=Math.Max(.15f,chargeMaxTime+a);break;
            case UpgradeStat.ChargeRange:chargeMaxRange+=a;chargeMinRange+=a*.25f;break;
            case UpgradeStat.ChargeWidth:chargeWidth+=a;break;
        }
    }
    void Finish(bool won)
    {
        slow=false;chargeTime=0;paused=false;pendingAction=-1;
        if(won){GameOver(true);return;}
        phase=Phase.Dying;phaseTime=0;ClearPanel();shake=22;
        Burst(position,Alpha(Ink,.4f),16);SplitShape(position,26,true,Ink);
        player.Hidden=knife.Hidden=nose.Hidden=true;
        PanelText("Dead","DEAD",500,300,72,Red,false);
        Log.Info($"[Rougelike] dying kills:{kills}");
    }
    void GameOver(bool won=false)
    {
        ClearWorld();ClearPanel();ResetPlayer();phase=won?Phase.Clear:Phase.Dead;phaseTime=0;position=new(300,470);
        PanelText("End title",won?"CLEAR":"GAME OVER",120,255,72,won?Ink:Red,false);
        PanelText("End stats",$"第 {wave+1} / 10 波  ·  击杀 {kills}  ·  {(int)runTime} 秒",124,340,26);
        PanelButton("Retry","再来一次",908,357,330,80,0,50);
        PanelButton("Back to menu","返回菜单",908,485,330,80,1,50);
        PanelText("End hint","走近挥刀选择  /  ENTER 重试  /  M 返回",240,585,26);
        Log.Info($"[Rougelike] {(won?"clear":"game over")} kills:{kills}");
    }
    void Render()
    {
        float angle=facing,knifeTheta=knifeFrom+(knifeTo-knifeFrom)*EaseQuint(Math.Min(1,knifeTime/.09f));
        float off=MathF.Abs(Wrap(knifeTheta-(swingBack?MathF.PI:0))),reach=Math.Clamp(1-off/Math.Max(tripSpan*.5f,.001f),0,1);
        float knifeRadius=42+(tripRadius-42)*reach+(knifeTime>=.09f?1.2f*MathF.Sin(elapsed*2.2f):0);
        player.Position=position;player.Angle=angle;player.Color=Mix(Ink,Red,Math.Clamp(hurtTime/.3f,0,1));
        if(invulnerable>0)player.Color=Alpha(player.Color,.65f+.35f*MathF.Sin(elapsed*11*MathF.Tau));
        knife.Position=position+Direction(angle+knifeTheta)*knifeRadius;knife.Angle=angle+knifeTheta+MathF.PI*.5f;knife.Size.Y=25.6f*(1+.35f*reach);
        nose.Position=position+Direction(angle)*31;nose.Angle=angle+MathF.PI/2;
        healthFill.Size.X=254*Math.Max(0,health)/(float)maxHealth;healthFill.Position.X=27+healthFill.Size.X*.5f;
        float dt=paused?0:Math.Clamp(Time.DeltaTime,0,.05f),energyRatio=energy/maxEnergy;
        energyDisplay=MoveToward(energyDisplay,energyRatio,1.1f*dt);energyTrailDisplay=energyTrailDisplay>energyRatio?MoveToward(energyTrailDisplay,energyRatio,.45f*dt):energyRatio;
        energyFill.Size.X=254*energyDisplay;energyFill.Position.X=27+energyFill.Size.X*.5f;
        energyTrail.Size.X=254*energyTrailDisplay;energyTrail.Position.X=27+energyTrail.Size.X*.5f;
        energyFill.Color=Mix(new(.3f,.55f,.92f),new(1,.35f,.3f),deniedTime/.24f);
        healthLabel.Text=$"{health} / {maxHealth}";energyLabel.Text="";
        float bannerAlpha=bannerTime>1.65f?(1.83f-bannerTime)/.18f:bannerTime<.45f?bannerTime/.45f:1;
        waveLabel.Color=Alpha(Ink,Math.Clamp(bannerAlpha,0,1));
        comboLabel.Text=combo>0?combo.ToString():"";comboLabel.Position.X=576-(comboLabel.Text?.Length??1)*12;
        skillLabel.Text=$"{(slowUnlocked?"SHIFT 时间凝滞  ":"")}{(holeUnlocked?"R 黑洞  ":"")}{(chargeUnlocked?"长按左键 蓄力斩  ":"")}P 暂停";
        bool hideHud=phase==Phase.Menu||phase is Phase.Dead or Phase.Clear||phase==Phase.Dying&&phaseTime>.67f;
        foreach(var v in hud)v.Hidden=hideHud;
        foreach(var v in comboControl.Parts){v.Hidden|=combo==0;v.Scale=1+.16f*comboBump/.11f;}
        if(phase==Phase.Dying&&phaseTime>.67f)foreach(var v in panel)v.Hidden=true;
        notice.Text=deniedTime>0?"能量不足":"";
        tint.Color=slow?new(.45f,.55f,1,.12f):new(0,0,0,0);
        foreach(var v in hurtEdges)v.Opacity=Math.Clamp(hurtTime/.34f,0,1)*7;
        bool dying=phase==Phase.Dying;
        deathCover.Color=new(0,0,0,dying?Math.Clamp((phaseTime-.67f)/.75f,0,1):0);
        for(int i=0;i<glitch.Count;i++)
        {
            var v=glitch[i];v.Hidden=!dying||phaseTime>1.42f;
            if(dying){v.Position=new(576+Range(-35,35),i*54+Range(-8,8));v.Size.Y=Range(1,8);v.Color=Alpha(i%3==0?Paper:Ink,Math.Min(1,phaseTime/.12f)*Range(.06f,.28f));}
        }
        camera.Vignette=.35f+Math.Clamp(hurtTime/.34f,0,1)*.35f;
        if(!paused)cameraTransform.Position=new(shake>0?Range(-shake,shake):0,shake>0?Range(-shake,shake):0,-10);
    }
    void Flush()
    {
        foreach(var v in visuals)
        {
            if(!v.Initialized)
            {
                if(!v.Entity.IsValid)continue;
                v.Transform=v.Entity.GetComponent<Transform>();
                if(v.Text is not null){v.Label=v.Entity.GetComponent<TextRenderer>();v.Label.Font=new(v.Texture);v.Label.FontSize=v.FontSize;v.Label.MaxWidth=0;v.Label.LineSpacing=1;}
                else{v.Sprite=v.Entity.GetComponent<SpriteRenderer>();v.Sprite.Sprite=new(v.Texture);v.Sprite.OrderInLayer=v.Order;}
                v.Initialized=true;
            }
            // Tc world text starts at the bottom of its line box. Our authored
            // coordinates use its top, like the source Godot canvas.
            // In Tc's +Z camera, larger 2D order must also be nearer in depth.
            Vector3 worldPosition=new(v.Position.X-576,324-v.Position.Y-(v.Text is null?0:v.FontSize*v.Scale),-v.Order*.005f);
            Vector3 worldScale=v.Sprite is not null?new(Math.Max(.001f,v.Size.X*v.Scale),Math.Max(.001f,v.Size.Y*v.Scale),1):new(v.Scale,v.Scale,1);
            Color color=Alpha(v.Color,v.Color.A*v.Opacity);bool enabled=!v.Hidden&&v.Opacity>.001f&&!(phase==Phase.Dying&&phaseTime>.67f&&v.Label is not null);
            if(!v.Applied||!worldPosition.Equals(v.LastPosition)){v.Transform!.Position=worldPosition;v.LastPosition=worldPosition;}
            if(!v.Applied||v.Angle!=v.LastAngle){v.Transform!.RotationEuler=new(0,0,-v.Angle);v.LastAngle=v.Angle;}
            if(!v.Applied||!worldScale.Equals(v.LastScale)){v.Transform!.Scale=worldScale;v.LastScale=worldScale;}
            if(v.Sprite is not null)
            {
                if(!v.Applied||!color.Equals(v.LastColor))v.Sprite.Color=color;
                if(!v.Applied||enabled!=v.LastEnabled)v.Sprite.Enabled=enabled;
            }
            if(v.Label is not null)
            {
                if(!v.Applied||!color.Equals(v.LastColor))v.Label.Color=color;
                if(!v.Applied||enabled!=v.LastEnabled)v.Label.Enabled=enabled;
                if(v.Text!=v.PreviousText){v.Label.Text=v.Text!;v.PreviousText=v.Text;}
            }
            v.LastColor=color;v.LastEnabled=enabled;v.Applied=true;
        }
    }
    float Range(float min,float max)=>min+(float)random.NextDouble()*(max-min);
    static float Length(Vector2 v)=>MathF.Sqrt(v.X*v.X+v.Y*v.Y);
    static Vector2 Normal(Vector2 v){float len=Length(v);return len<.001f?Vector2.Zero:v*(1/len);}
    static Vector2 Direction(float a)=>new(MathF.Cos(a),MathF.Sin(a));
    static float Dot(Vector2 a,Vector2 b)=>a.X*b.X+a.Y*b.Y;
    static float EaseQuint(float t){float rest=1-Math.Clamp(t,0,1);return 1-rest*rest*rest*rest*rest;}
    static Vector2 Rotate(Vector2 v,float angle){float c=MathF.Cos(angle),s=MathF.Sin(angle);return new(v.X*c-v.Y*s,v.X*s+v.Y*c);}
    static float MoveToward(float value,float target,float amount)=>value<target?Math.Min(target,value+amount):Math.Max(target,value-amount);
    static Color Mix(Color a,Color b,float t)=>new(a.R+(b.R-a.R)*t,a.G+(b.G-a.G)*t,a.B+(b.B-a.B)*t,a.A+(b.A-a.A)*t);
    static bool CirclePolygon(Vector2 center,float radius,Vector2[] poly)
    {
        bool inside=false;
        for(int i=0,j=poly.Length-1;i<poly.Length;j=i++)
        {
            Vector2 a=poly[j],b=poly[i];
            if((a.Y>center.Y)!=(b.Y>center.Y)&&center.X<(b.X-a.X)*(center.Y-a.Y)/(b.Y-a.Y)+a.X)inside=!inside;
            Vector2 edge=b-a;float lengthSquared=Dot(edge,edge);
            float t=lengthSquared<.000001f?0:Math.Clamp(Dot(center-a,edge)/lengthSquared,0,1);
            Vector2 nearest=a+edge*t-center;if(Dot(nearest,nearest)<=radius*radius)return true;
        }
        return inside;
    }
    static float Wrap(float a){while(a>MathF.PI)a-=MathF.Tau;while(a<-MathF.PI)a+=MathF.Tau;return a;}
    static Color Alpha(Color c,float a)=>new(c.R,c.G,c.B,a);
}

public enum UpgradeStat
    {
        MaxHealth,
        Heal,
        MoveSpeed,
        AttackCooldown,
        SlashRadius,
        SlashSpan,
        Invulnerability,
        MaxEnergy,
        EnergyRegen,
        AttackCost,
        UnlockSlow,
        SlowDrain,
        SlowDepth,
        UnlockBlackHole,
        BlackHoleCost,
        BlackHoleDuration,
        BlackHoleRadius,
        UnlockCharge,
        ChargeFaster,
        ChargeRange,
        ChargeWidth
    }

    public record UpgradeChoice(UpgradeStat Stat, int Rarity, float Amount);

    /// <summary>
    /// Original Godot demo's wave tables and upgrade lottery, without engine dependencies.
    /// Rarities: white, blue, purple, gold, red, time (orange), void, silver.
    /// </summary>
    public static class RougelikeRules
    {
        public static readonly int[] WaveCounts = { 5, 5, 10, 5, 10, 20, 20, 60, 60, 60 };
        public static readonly int[] WaveHealth = { 1, 2, 2, 4, 5, 3, 5, 1, 3, 5 };

        public static readonly string[] Names =
        {
            "生命上限", "回复生命", "移动速度", "攻击间隔", "刀光半径", "刀光张角",
            "无敌时间", "能量上限", "能量恢复", "挥刀消耗", "Chronostasis", "时之砂",
            "凝滞", "黑洞", "奇点", "视界", "引力井", "蓄力斩", "疾蓄", "贯空", "广刃"
        };

        public static readonly float[] BaseAmounts =
        {
            1f, 1f, 26f, -.006f, 7f, 10f, .05f, 25f, 8f, -1f,
            0f, -4f, -.03f, 0f, -6f, .8f, 45f, 0f, -.12f, 90f, 8f
        };

        private static readonly float[] RarityMultipliers = { 1f, 1.7f, 2.8f, 4.4f, 7f, 1f, 1f, 1f };
        private static readonly double[] EarlyWeights = { 62, 25, 9, 3, 1 };
        private static readonly double[] LateWeights = { 6, 20, 30, 28, 16 };

        /// <summary>
        /// Draws one choice after the given one-based wave. Choices are independent,
        /// so duplicate cards remain possible, as in the source demo.
        /// </summary>
        public static UpgradeChoice Roll(Random random, int clearedWave, bool slow, bool hole, bool charge)
        {
            if (random == null) throw new ArgumentNullException(nameof(random));

            double specialChance = slow || hole || charge ? .22 : .10;
            if (random.NextDouble() < specialChance)
            {
                var pool = new List<UpgradeStat>(8);
                if (slow)
                {
                    pool.Add(UpgradeStat.SlowDrain);
                    pool.Add(UpgradeStat.SlowDepth);
                }
                else pool.Add(UpgradeStat.UnlockSlow);

                if (hole)
                {
                    pool.Add(UpgradeStat.BlackHoleCost);
                    pool.Add(UpgradeStat.BlackHoleDuration);
                    pool.Add(UpgradeStat.BlackHoleRadius);
                }
                else pool.Add(UpgradeStat.UnlockBlackHole);

                if (charge)
                {
                    pool.Add(UpgradeStat.ChargeFaster);
                    pool.Add(UpgradeStat.ChargeRange);
                    pool.Add(UpgradeStat.ChargeWidth);
                }
                else pool.Add(UpgradeStat.UnlockCharge);

                UpgradeStat stat = pool[random.Next(pool.Count)];
                int rarity = stat >= UpgradeStat.UnlockCharge ? 7
                    : stat >= UpgradeStat.UnlockBlackHole ? 6 : 5;
                return MakeChoice(stat, rarity);
            }

            double progress = Math.Max(0, Math.Min(1, (clearedWave - 1) / (double)(WaveCounts.Length - 1)));
            double total = 0;
            for (int i = 0; i < EarlyWeights.Length; i++)
                total += EarlyWeights[i] + (LateWeights[i] - EarlyWeights[i]) * progress;

            double draw = random.NextDouble() * total;
            int normalRarity = EarlyWeights.Length - 1;
            for (int i = 0; i < EarlyWeights.Length; i++)
            {
                draw -= EarlyWeights[i] + (LateWeights[i] - EarlyWeights[i]) * progress;
                if (draw <= 0)
                {
                    normalRarity = i;
                    break;
                }
            }

            return MakeChoice((UpgradeStat)random.Next((int)UpgradeStat.UnlockSlow), normalRarity);
        }

        public static string Describe(UpgradeChoice choice)
        {
            if (choice == null) throw new ArgumentNullException(nameof(choice));

            switch (choice.Stat)
            {
                case UpgradeStat.UnlockSlow: return "按住 Shift 减缓时间";
                case UpgradeStat.UnlockBlackHole: return "按 R 在鼠标处放置";
                case UpgradeStat.UnlockCharge: return "按住左键蓄力，松手放出";
                case UpgradeStat.AttackCooldown: return Signed(choice.Amount, 3) + " 秒";
                case UpgradeStat.Invulnerability:
                case UpgradeStat.ChargeFaster: return Signed(choice.Amount, 2) + " 秒";
                case UpgradeStat.BlackHoleDuration: return Signed(choice.Amount, 1) + " 秒";
                case UpgradeStat.SlashSpan: return Signed(choice.Amount, 0) + " 度";
                case UpgradeStat.EnergyRegen:
                case UpgradeStat.SlowDrain: return Signed(choice.Amount, 0) + " 每秒";
                case UpgradeStat.AttackCost: return Signed(choice.Amount, 1);
                case UpgradeStat.SlowDepth: return Signed(choice.Amount, 2);
                case UpgradeStat.BlackHoleCost: return Signed(choice.Amount, 0) + " 能量";
                case UpgradeStat.BlackHoleRadius: return Signed(choice.Amount, 0) + " 范围";
                case UpgradeStat.ChargeRange: return Signed(choice.Amount, 0) + " 距离";
                case UpgradeStat.ChargeWidth: return Signed(choice.Amount, 0) + " 宽度";
                default: return Signed(choice.Amount, 0);
            }
        }

        private static UpgradeChoice MakeChoice(UpgradeStat stat, int rarity)
        {
            return new UpgradeChoice(stat, rarity, BaseAmounts[(int)stat] * RarityMultipliers[rarity]);
        }

        private static string Signed(float amount, int decimals)
        {
            string number = decimals == 0 ? "0" : "0." + new string('0', decimals);
            return amount.ToString("+" + number + ";-" + number + ";+" + number, CultureInfo.InvariantCulture);
        }
    }

// Uses the engine's AudioSource -> AudioEngine -> WebAudioDevice path.
// The original has one shared SFX player, so a new cue interrupts the old one.
internal sealed class RougelikeAudio
{
    readonly Entity[] entities = new Entity[6];
    readonly AudioSource?[] sources = new AudioSource?[6];
    int pendingCue = -1, activeCue = -1;
    bool logged, musicPlaying, wasPaused;
    float previousPitch = -1;
    public RougelikeAudio()
    {
        for (int i=0;i<entities.Length;i++)
        {
            var entity=World.CreateEntity(i==0?"Welcome music":"SFX "+i);
            entities[i]=entity;
            var audio=entity.AddComponent<AudioSource>();
            audio.Clip=new AssetRef<AudioAsset>(6100000000000000030UL+(ulong)i);
            audio.PlayOnStart=false;
            audio.Loop=i==0;
            audio.Streaming=false;
            audio.SpatialBlend=0;
            audio.Volume=1;
            audio.MixerGroup=i==0?AudioMixerGroup.Music:AudioMixerGroup.SFX;
        }
    }
    public void Cue(int cue) { if(cue>=1&&cue<6)pendingCue=cue; }
    public void Tick(bool musicEnabled,bool paused,float pitch)
    {
        for(int i=0;i<entities.Length;i++)
            if(sources[i] is null&&entities[i].IsValid)sources[i]=entities[i].GetComponent<AudioSource>();
        var music=sources[0];
        if(music is null)return;
        if(!logged)
        {
            logged=true;
            Log.Info("[Rougelike] audio backend:"+AudioSystem.BackendName);
        }
        if(previousPitch!=pitch){music.Pitch=pitch;previousPitch=pitch;}
        if(musicEnabled!=musicPlaying)
        {
            if(musicEnabled){music.Play();if(paused&&music.State==AudioPlaybackState.Playing)music.Pause();}
            else if(music.State!=AudioPlaybackState.Stopped)music.Stop();
            musicPlaying=musicEnabled;
        }
        if(paused!=wasPaused)
        {
            if(paused)
            {
                if(musicPlaying&&music.State==AudioPlaybackState.Playing)music.Pause();
                if(activeCue>0&&sources[activeCue] is {} active&&active.State==AudioPlaybackState.Playing)active.Pause();
            }
            else
            {
                if(musicPlaying&&music.State==AudioPlaybackState.Paused)music.Play();
                if(activeCue>0&&sources[activeCue] is {} active&&active.State==AudioPlaybackState.Paused)active.Play();
            }
            wasPaused=paused;
        }
        if(paused||pendingCue<0||sources[pendingCue] is not {} next)return;
        if(activeCue>0&&sources[activeCue] is {} previous&&previous.State!=AudioPlaybackState.Stopped)previous.Stop();
        next.Play();activeCue=pendingCue;pendingCue=-1;
    }
    public void Stop()
    {
        foreach(var source in sources)if(source is not null&&source.State!=AudioPlaybackState.Stopped)source.Stop();
        musicPlaying=false;
        pendingCue=activeCue=-1;
    }
}
