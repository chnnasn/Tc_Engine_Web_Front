using System;
using System.Collections.Generic;
using TomCat;
namespace TomCatGame;
// Original Start / SampleScene bindings, fitted uniformly from 1920x1080.
public sealed class ShelterGame : MonoBehaviour
{
    const ulong Art=6300000000000000000UL,Font=Art+20;
    const float Unit=64,Cell=129.6f;
    static readonly Color White=new(1,1,1,1),Ink=new(.10f,.09f,.07f,1),Red=new(.78f,.16f,.10f,1);
    enum Window { None,Build,Dispatch,Report,Settings,Result }
    sealed class Visual
    {
        public Entity Entity=null!;public Transform? Transform;public SpriteRenderer? Sprite;public TextRenderer? Label;
        public Vector2 Position,Size=Vector2.One;public Vector3 LastPosition,LastScale,LastRotation;
        public Color Color=White,LastColor;public ulong Texture,LastTexture;public float Angle,FontSize,TextHeight;public int Order;
        public string? Text,LastText;public bool Visible,Initialized,Applied,LastVisible,FlipX,FlipY,Local;
    }
    readonly List<Visual> visuals=[],menu=[],game=[],build=[],dispatch=[],report=[],settings=[],result=[];
    readonly Visual[] ground=new Visual[25],buildings=new Visual[25],rain=new Visual[96],outline=new Visual[4];
    readonly Dictionary<string,Visual> named=new();readonly Dictionary<Visual,Vector2> buildBase=new();
    ShelterModel model=new();Camera camera=null!;Entity viewport=null!,musicEntity=null!,rainEntity=null!;
    RectTransform? viewportRect;Transform? rainTransform;AudioSource? music;Visual shade=null!,warm=null!;
    Window window;float width=1280,height=720,worldHeight=16.875f,lastHeight=-1,accumulator,rainTime,uiTime,lastRainOffset=float.NaN,buildDx,buildDy;
    int selected=12,party,speed=1,lastVersion=-1,frames;bool started,muted,musicStarted,sliderDrag;string feedback="";
    void Awake()
    {
        camera=World.Find("MainCamera")!.GetComponent<Camera>();camera.Entity.GetComponent<Transform>().Position=new(0,0,-10);
        camera.BackgroundColor=new(189/255f,155/255f,110/255f,1);camera.Vignette=0;camera.Exposure=0;camera.Saturation=1;
        var canvas=World.CreateEntity("Shelter viewport");canvas.AddComponent<Canvas>().ScaleMode=CanvasScaleMode.ConstantPixelSize;
        viewport=World.CreateEntity("Shelter bounds",default,canvas);var rect=viewport.AddComponent<RectTransform>();rect.AnchorMin=Vector2.Zero;rect.AnchorMax=Vector2.One;rect.SizeDelta=Vector2.Zero;
        Picture(menu,"Menu",10,0,0,1920,1080,-10);Picture(menu,"Title",11,489,11,943,452,10);
        Picture(menu,"Start",40,773,518,374,165,10);Picture(menu,"Menu quit",41,764,682,393,173,10);Label(menu,"Menu note","",600,900,30,Ink);
        Picture(game,"Frame",18,0,0,1920,1080,20);
        for(int i=0;i<25;i++){int r=ShelterModel.Ring(i);float x=960+(i%5-2)*Cell,y=540+(i/5-2)*Cell;
            ground[i]=Picture(game,"Plot "+i,12+r,x-Cell/2,y-Cell/2,Cell,Cell,2);
            buildings[i]=Picture(null,"Building "+i,15+r,x-Cell/2,y-Cell*.8f,Cell,Cell*1.6f,r==0?4:3);}
        Picture(game,"Wood icon",52,37,57,97,81,21);Label(game,"Wood","10",142,90,43,Ink);
        Picture(game,"Stone icon",53,404,60,101,75,21);Label(game,"Stone","10",514,90,43,Ink);
        Picture(game,"Food icon",54,778,53,89,90,21);Label(game,"Food","400",877,90,43,Ink);
        Picture(game,"Settings button",42,1814,53,83,83,21);Label(game,"Countdown title","风暴倒计时",25,880,37,Ink);Label(game,"Countdown","05:00:00",25,950,82,Ink);
        // The original Consume label extends beyond the fixed reference canvas.
        // Retain its bottom-right grouping while making every control reachable.
        Picture(game,"Adventure",43,1735,849,152,202,21);Label(game,"Daily title","每日消耗 / 留守居民",1490,755,28,Ink);
        Label(game,"Daily","200 / 1",1570,795,37,Ink);Label(game,"Trip status","派遣居民",1510,920,30,Ink);Label(game,"Day","",790,1010,28,Ink);
        shade=Picture(null,"Modal shade",19,0,0,1920,1080,60);shade.Color=new(0,0,0,.5f);
        for(int i=0;i<4;i++)outline[i]=Sprite("Selected edge "+i,19,0,0,i<2?Cell/Unit:.04f,i<2?.04f:Cell/Unit,61);
        Picture(build,"Build preview",15,912,463,96,154,65);Label(build,"Build name","",1032,482,29,White);
        Picture(build,"Build wood icon",52,1031,525,37,31,65);Label(build,"Build wood","",1073,530,26,White);
        Picture(build,"Build stone icon",53,1031,559,37,27,65);Label(build,"Build stone","",1073,562,26,White);
        Picture(build,"Build cancel",46,881,600,195,103,65);Picture(build,"Build confirm",45,1088,596,211,111,65);Label(build,"Build feedback","",878,720,27,White);
        Picture(dispatch,"Dispatch panel",47,551,232,817,511,65);Label(dispatch,"Party","派遣人数：0",822,495,35,Ink);Label(dispatch,"Cost","需要消耗食物：0",822,554,35,Ink);
        Picture(dispatch,"Slider track",19,752,610,416,26,66).Color=new(.65f,.65f,.56f,1);Picture(dispatch,"Slider fill",19,752,610,1,26,67).Color=new(.96f,.93f,.78f,1);
        Picture(dispatch,"Slider handle",19,752,597,52,52,68);Label(dispatch,"Dispatch feedback","拖动滑块选择人数",760,668,27,Ink);
        Picture(dispatch,"Dispatch cancel",46,701,731,269,135,65);Picture(dispatch,"Dispatch confirm",48,1009,731,269,135,65);
        Picture(report,"Report panel",49,551,232,817,511,65);Label(report,"Losses","",790,551,32,Ink);Label(report,"Trip food","",790,594,32,Ink);
        Picture(report,"Reward wood icon",52,686,641,65,54,66);Label(report,"Reward wood","",756,654,29,Ink);Picture(report,"Reward stone icon",53,859,644,64,47,66);Label(report,"Reward stone","",929,654,29,Ink);Label(report,"Reward people","",1094,654,29,Ink);Picture(report,"Collect confirm",48,825,731,269,135,65);
        Picture(settings,"Resume",50,795,307,330,145,65);Picture(settings,"Return menu",51,802,470,316,139,65);Picture(settings,"Quit",41,795,628,329,145,65);
        Label(settings,"Speed","",690,830,31,White);Label(settings,"Mute","",1090,830,31,White);Label(settings,"Settings hint","点击切换速度或声音",760,895,27,White);
        Picture(result,"Result panel",47,445,231,1030,618,65);Label(result,"Result title","",675,510,43,Ink);Label(result,"Result details","",650,590,30,Ink);Picture(result,"Result confirm",48,804,812,312,156,65);
        rainEntity=World.CreateEntity("Shelter rain band",new Vector3(0,1000,0));
        for(int i=0;i<rain.Length;i++){int j=i%48;rain[i]=Sprite("Rain "+i,19,-14+(j*7.31f)%28,8-(j*1.73f)%16+(i/48)*16,.035f,.6f,30,rainEntity);rain[i].Local=true;rain[i].Visible=true;rain[i].Color=new(.68f,.83f,.95f,.7f);rain[i].Angle=-.35f;}
        warm=Label(null,"Glyph warmup","0123456789 /:+-×()，。：！？主城食物产出房城墙木材石头每日消耗留守居民派遣人数需要拖动滑块选择尚未拥有至少一位资源不足已有建筑此地块不能重复建造探索剩余秒完成领取人员损耗新增食物风暴倒计时继续暂停速度声音开启关闭游戏退出返回菜单开始成功抵御失守恭喜过关点击内圈绿色空地防御建造取消确认已资源木材不足石头不足建造成功了事们住你分切可器天存安平待或所换撑播放无期毁没活第等设请避部间难",10000,10000,28,Ink);warm.Visible=true;
        musicEntity=World.CreateEntity("Shelter music");var a=musicEntity.AddComponent<AudioSource>();a.Clip=new(Art+30);a.PlayOnStart=false;a.Loop=true;a.Streaming=false;a.SpatialBlend=0;a.Volume=.35f;a.MixerGroup=AudioMixerGroup.Music;
        Log.Info("[Shelter] initialized: original scene bindings and modal UI");
    }
    Visual Sprite(string name,int art,float x,float y,float w,float h,int order=0,Entity? parent=null){var e=World.CreateEntity(name,new Vector3(10000,10000,0),parent);e.AddComponent<SpriteRenderer>();var v=new Visual{Entity=e,Texture=Art+(ulong)art,Position=new(x,y),Size=new(w,h),Order=order};visuals.Add(v);return v;}
    Visual Picture(List<Visual>? group,string name,int art,float x,float y,float w,float h,int order){var v=Sprite(name,art,(x+w/2-960)/Unit,(540-y-h/2)/Unit,w/Unit,h/Unit,order);group?.Add(v);named[name]=v;return v;}
    Visual Label(List<Visual>? group,string name,string text,float x,float y,float size,Color color){var e=World.CreateEntity(name,new Vector3(10000,10000,0));e.AddComponent<TextRenderer>();var v=new Visual{Entity=e,Text=text,Position=new((x-960)/Unit,(540-y)/Unit),FontSize=size/Unit,Color=color,Order=250};visuals.Add(v);group?.Add(v);named[name]=v;return v;}
    void SetWindow(Window next){window=next;sliderDrag=false;feedback="";lastVersion=-1;Log.Info("[Shelter] window:"+next);}
    void StartGame(){model=new();started=true;party=0;speed=1;selected=12;accumulator=rainTime=0;SetWindow(Window.None);if(music is not null)music.Play();Log.Info("[Shelter] start");}
    void ToMenu(){started=false;SetWindow(Window.None);Log.Info("[Shelter] menu");}
    bool Hit(string name,float x,float y){var v=named[name];return Math.Abs((x-960)/Unit-v.Position.X)<=v.Size.X/2&&Math.Abs((540-y)/Unit-v.Position.Y)<=v.Size.Y/2;}
    void SelectPlot(int i){selected=i;buildDx=(i%5-2)*Cell;buildDy=(i/5-2)*Cell;SetWindow(Window.Build);Log.Info("[Shelter] selected:"+i);}
    void Build(){if(model.Build(selected)){Log.Info("[Shelter] build:"+selected);SetWindow(Window.None);}else{feedback=BuildReason();lastVersion=-1;Log.Info("[Shelter] build blocked:"+feedback);}}
    string BuildReason(){if(model.Buildings[selected])return "此地块已有建筑，不能重复建造";int r=ShelterModel.Ring(selected),cost=model.Cost(r);if(model.Storm||model.Result)return "风暴期间不能建造";if(r==0)return "主城不能重复建造";return (r==1?model.Wood:model.Stone)<cost?(r==1?"木材不足，需要 ":"石头不足，需要 ")+cost:"";}
    string DispatchReason(){if(party<1)return model.People<1?"没有留守居民，等待探索返回":"拖动滑块，至少选择一位居民";if(party>model.People)return "留守居民人数不足";if(model.Food<party*200)return "食物不足，需要 "+party*200;return "";}
    void ConfirmDispatch(){if(model.Dispatch(party)){Log.Info("[Shelter] dispatch:"+party);SetWindow(Window.None);}else{feedback=DispatchReason();lastVersion=-1;Log.Info("[Shelter] dispatch blocked:"+feedback);}}
    void Collect(){if(model.Collect()){Log.Info("[Shelter] collect");SetWindow(Window.None);}}
    void Update()
    {
        frames++;if(viewport.IsValid){viewportRect??=viewport.GetComponent<RectTransform>();var r=viewportRect.RuntimeRect;if(r.Width>0&&r.Height>0){width=r.Width;height=r.Height;}}
        worldHeight=Math.Max(16.875f,30*height/Math.Max(1,width));if(worldHeight!=lastHeight){camera.OrthographicSize=worldHeight;lastHeight=worldHeight;}
        if(frames>3&&musicEntity.IsValid&&!musicStarted){music=musicEntity.GetComponent<AudioSource>();music.Play();musicStarted=true;}
        var mouse=Input.MousePosition;float x=960+(mouse.X-width/2)*worldHeight/height*Unit,y=540+(mouse.Y-height/2)*worldHeight/height*Unit;
        bool click=frames>30&&Input.WasMouseButtonPressed(MouseButton.Left),enter=Input.WasKeyPressed(KeyCode.Enter),escape=Input.WasKeyPressed(KeyCode.Escape);
        if(!started){if(enter||(click&&Hit("Start",x,y)))StartGame();else if(click&&Hit("Menu quit",x,y)){named["Menu note"].Text="游戏已退出，可关闭播放器或重新开始";music?.Stop();}}
        else {
            if(Input.WasKeyPressed(KeyCode.M)){muted=!muted;if(music is not null)music.Volume=muted?0:.35f;lastVersion=-1;}
            if(Input.WasKeyPressed(KeyCode.P)&&window!=Window.Result&&window!=Window.Report){SetWindow(window==Window.Settings?Window.None:Window.Settings);Log.Info("[Shelter] paused:"+(window==Window.Settings));}
            else if(escape&&window!=Window.Result&&window!=Window.Report)SetWindow(window==Window.None?Window.Settings:Window.None);
            else HandleInput(click,enter,x,y);
            float dt=Math.Clamp(Time.deltaTime,0,.1f);
            if(started&&window!=Window.Settings){
                if(model.Storm){rainTime+=dt;if(rainTime>=9){model.ResolveStorm();SetWindow(Window.Result);Log.Info("[Shelter] storm result:"+(model.Lost?"lost":model.Won?"won":"survived"));}}
                else if(!model.Result){accumulator+=dt*speed;int budget=0;while(accumulator>=1&&budget++<4&&!model.Storm){accumulator--;model.Tick();if(model.Storm){rainTime=0;SetWindow(Window.None);Log.Info("[Shelter] storm:"+model.NextStorm);}}}
                if(model.Report&&!model.Storm&&!model.Result&&window!=Window.Report)SetWindow(Window.Report);
            }
        }
        uiTime+=Math.Clamp(Time.deltaTime,0,.1f);if(lastVersion!=model.Version&&(uiTime>=.15f||lastVersion<0)){Refresh();lastVersion=model.Version;uiTime=0;}
        Show(menu,!started);Show(game,started);Show(build,started&&window==Window.Build);Show(dispatch,started&&window==Window.Dispatch);Show(report,started&&window==Window.Report);Show(settings,started&&window==Window.Settings);Show(result,started&&window==Window.Result);
        for(int i=0;i<25;i++)buildings[i].Visible=started&&model.Buildings[i];shade.Visible=started&&(window==Window.Build||window==Window.Settings);
        for(int i=0;i<4;i++){outline[i].Visible=started&&window==Window.Build;var p=ground[selected].Position;float half=Cell/Unit/2;outline[i].Position=new(p.X+(i==2?-half:i==3?half:0),p.Y+(i==0?half:i==1?-half:0));}
        if(rainEntity.IsValid){rainTransform??=rainEntity.GetComponent<Transform>();float off=started&&model.Storm?-(rainTime*11)%16:1000;if(off!=lastRainOffset){rainTransform.LocalPosition=new(0,off,0);lastRainOffset=off;}}
        if(frames==30){warm.Visible=false;Log.Info("[Shelter] ready");}Flush();
    }
    void HandleInput(bool click,bool enter,float x,float y)
    {
        if(window==Window.Settings){
            if(enter||(click&&Hit("Resume",x,y)))SetWindow(Window.None);
            else if(click&&Hit("Return menu",x,y))ToMenu();
            else if(click&&Hit("Quit",x,y)){ToMenu();music?.Stop();named["Menu note"].Text="游戏已退出，可关闭播放器或重新开始";}
            else if((click&&x>=660&&x<1000&&y>=805&&y<885)||Input.WasKeyPressed(KeyCode.Space)){speed=speed==1?4:speed==4?16:1;lastVersion=-1;Log.Info("[Shelter] speed:"+speed);}
            else if(click&&x>=1060&&x<1370&&y>=805&&y<885){muted=!muted;if(music is not null)music.Volume=muted?0:.35f;lastVersion=-1;}return;
        }
        if(window==Window.Result){if(enter||(click&&Hit("Result confirm",x,y))){if(model.Lost||model.Won)ToMenu();else{model.Continue();rainTime=0;SetWindow(Window.None);}}return;}
        if(window==Window.Report){if(enter||(click&&Hit("Collect confirm",x,y)))Collect();return;}
        if(window==Window.Build){if(click&&Hit("Build cancel",x,y))SetWindow(Window.None);else if(enter||Input.WasKeyPressed(KeyCode.B)||(click&&Hit("Build confirm",x,y)))Build();return;}
        if(window==Window.Dispatch){
            if(click&&x>=730&&x<=1190&&y>=585&&y<=665)sliderDrag=true;
            if(sliderDrag){if(click||Input.IsMouseButtonHeld(MouseButton.Left)){int next=(int)MathF.Round(Math.Clamp((x-778)/364,0,1)*Math.Min(29,model.People));if(next!=party){party=next;feedback="";lastVersion=-1;Log.Info("[Shelter] party:"+party);}}else sliderDrag=false;}
            if(Input.WasKeyPressed(KeyCode.Up)){party=Math.Min(Math.Min(model.People,29),party+1);lastVersion=-1;}
            if(Input.WasKeyPressed(KeyCode.Down)){party=Math.Max(0,party-1);lastVersion=-1;}
            if(click&&Hit("Dispatch cancel",x,y))SetWindow(Window.None);else if(enter||(click&&Hit("Dispatch confirm",x,y)))ConfirmDispatch();return;
        }
        if(model.Storm||model.Result)return;
        if(click&&Hit("Settings button",x,y)){SetWindow(Window.Settings);return;}
        if((click&&Hit("Adventure",x,y))||Input.WasKeyPressed(KeyCode.E)){if(model.Report)SetWindow(Window.Report);else if(model.Trip==0){party=0;SetWindow(Window.Dispatch);}return;}
        if(click&&x>=636&&x<1284&&y>=216&&y<864){int col=(int)((x-636)/Cell),row=(int)((y-216)/Cell);SelectPlot(row*5+col);}
    }
    static void Show(List<Visual> list,bool value){foreach(var v in list)v.Visible=value;}
    void Refresh()
    {
        named["Wood"].Text=model.Wood.ToString();named["Stone"].Text=model.Stone.ToString();named["Food"].Text=model.Food.ToString();
        int remain=Math.Max(0,model.Remaining),days=remain/300,hours=(int)(remain%300/12.5f),minutes=(int)(remain%12.5f/.20833333f);
        named["Countdown"].Text=$"{days:00}:{hours:00}:{minutes:00}";named["Daily"].Text=model.People*200+" / "+model.People;
        named["Trip status"].Text=model.Trip>0?"探索剩余 "+model.Trip+" 秒":model.Report?"探索完成":"派遣居民";
        named["Day"].Text="第 "+model.Day+" 天   防御 "+model.Defence+(speed==1?"":"   "+speed+"×");
        int ring=ShelterModel.Ring(selected);string reason=BuildReason();named["Build preview"].Texture=Art+(ulong)(15+ring);named["Build preview"].Color=new(1,1,1,.65f);
        named["Build name"].Text=ring==0?"主城":ring==1?"食物产出房":"城墙";named["Build wood"].Text=(ring==1?model.Cost(1):0).ToString();named["Build stone"].Text=(ring==2?model.Cost(2):0).ToString();
        named["Build wood"].Color=ring==1&&model.Wood<model.Cost(1)?Red:White;named["Build stone"].Color=ring==2&&model.Stone<model.Cost(2)?Red:White;
        named["Build confirm"].Color=reason==""?White:new(1,.45f,.40f,1);named["Build feedback"].Text=feedback!=""?feedback:reason;
        float dx=Math.Clamp(buildDx,-780,530),dy=Math.Clamp(buildDy,-400,250);
        foreach(var v in build){if(!buildBase.TryGetValue(v,out var p)){p=v.Position;buildBase[v]=p;}v.Position=new(p.X+dx/Unit,p.Y-dy/Unit);}
        named["Party"].Text="派遣人数："+party;named["Cost"].Text="需要消耗食物："+party*200;string dr=DispatchReason();named["Cost"].Color=model.Food<party*200?Red:Ink;
        named["Dispatch confirm"].Color=dr==""?White:new(.65f,.65f,.65f,1);named["Dispatch feedback"].Text=feedback!=""?feedback:party==0?dr:"探索时间："+(party*8+50)+" 秒";
        float ratio=model.People>0?(float)party/Math.Min(29,model.People):0;named["Slider handle"].Position=new((778+364*ratio-960)/Unit,(540-623)/Unit);
        named["Slider fill"].Size=new(Math.Max(1,26+364*ratio)/Unit,26/Unit);named["Slider fill"].Position=new((752+(26+364*ratio)/2-960)/Unit,(540-623)/Unit);
        named["Losses"].Text="人员损耗："+(model.Party<29?1:0);named["Trip food"].Text="食物消耗："+model.Party*200;named["Reward wood"].Text=model.TripWood.ToString();named["Reward stone"].Text=model.TripStone.ToString();named["Reward people"].Text="居民 +"+(model.Party<29?2:1);
        named["Speed"].Text="速度 "+speed+"×  / 点击切换";named["Mute"].Text="声音："+(muted?"关闭":"开启");
        named["Result title"].Text=model.Won?"恭喜过关":model.Lost?"你存活了 "+model.NextStorm+" 天":"恭喜你撑过了风暴";
        named["Result details"].Text=model.Lost?"食物 "+model.Food+" / "+ShelterModel.FoodNeeds[model.Stage]+"\n防御 "+model.Defence+" / "+ShelterModel.DefenceNeeds[model.Stage]:model.Won?"守住了避难所，居民们平安无事。":"部分建筑已损毁，请继续建设。";
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
            if(!v.Applied||!position.Equals(v.LastPosition)){if(v.Local)v.Transform!.LocalPosition=position;else v.Transform!.Position=position;v.LastPosition=position;}
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
    void OnDestroy(){if(music is not null)music.Stop();}
}
