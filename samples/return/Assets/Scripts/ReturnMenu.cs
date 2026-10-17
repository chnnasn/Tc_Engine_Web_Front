using System;
using TomCat;

namespace TomCatGame;

internal enum ReturnMenuAction { None, Start, Resume, Restart, Quit }

internal sealed class ReturnMenu
{
    const float DesignWidth=1920,DesignHeight=1080;
    readonly Entity canvasEntity;
    readonly Canvas canvas;
    readonly Node[] nodes;
    readonly ReturnMenuNode[] sources;
    readonly float sourceScale;
    readonly bool fitDesign;
    readonly int buttonCount;
    bool visible,interactable;
    float scale=-1;

    sealed class Node
    {
        public Entity Entity=null!;
        public Transform Transform=null!;
        public UIButton? Button;
        public ulong ClickSerial;
        public bool Active,Hovered;
        public int ButtonAncestor=-1;
        public float Factor=1,FromFactor=1,TransitionTime,HoverTime;
        public Rect Rect;
        public Affine Matrix;
    }

    readonly struct Rect(float x,float y,float w,float h)
    {
        public readonly float X=x,Y=y,W=w,H=h;
    }
    readonly struct Affine(float a,float b,float c,float d,float x,float y)
    {
        public readonly float A=a,B=b,C=c,D=d,X=x,Y=y;
        public static readonly Affine Identity=new(1,0,0,1,0,0);
        public Affine Then(Affine child)=>new(
            A*child.A+C*child.B,B*child.A+D*child.B,
            A*child.C+C*child.D,B*child.C+D*child.D,
            A*child.X+C*child.Y+X,B*child.X+D*child.Y+Y);
        public bool Contains(Rect rect,float x,float y)
        {
            float determinant=A*D-B*C;
            if(MathF.Abs(determinant)<1e-8f)return false;
            float dx=x-X,dy=y-Y;
            float localX=(D*dx-C*dy)/determinant,localY=(-B*dx+A*dy)/determinant;
            return localX>=rect.X&&localX<=rect.X+rect.W&&localY>=rect.Y&&localY<=rect.Y+rect.H;
        }
    }

    public ReturnMenu():this("Main",ReturnMenuData.Nodes,ReturnMenuData.ScaleFactor,100) { }

    public ReturnMenu(string name,ReturnMenuNode[] sources,float sourceScale,int order,bool fitDesign=true)
    {
        this.sources=sources;this.sourceScale=sourceScale;this.fitDesign=fitDesign;
        canvasEntity=World.CreateEntity("Return original "+name+" Canvas");
        canvas=canvasEntity.AddComponent<Canvas>();
        canvas.ScaleMode=CanvasScaleMode.ConstantPixelSize;
        canvas.ScaleFactor=sourceScale;
        canvas.SortingOrder=order;
        foreach(var source in sources)if(source.Button is not null)buttonCount++;
        if(buttonCount>0)
        {
            var events=canvasEntity.AddComponent<UIEventSystem>();
            events.ConsumeGameplayInput=true;events.WrapNavigation=true;
        }
        // Fit the complete original 1920x1080 composition inside the player.
        // A fixed logical root keeps source edge anchors inside that composition.
        var root=World.CreateEntity(name+" design frame",default,canvasEntity);
        var rootRect=root.AddComponent<RectTransform>();
        rootRect.Pivot=new(.5f,.5f);
        rootRect.AnchorMin=fitDesign?new(.5f,.5f):Vector2.Zero;
        rootRect.AnchorMax=fitDesign?new(.5f,.5f):Vector2.One;
        rootRect.AnchoredPosition=Vector2.Zero;
        rootRect.SizeDelta=fitDesign?new(DesignWidth/sourceScale,DesignHeight/sourceScale):Vector2.Zero;
        nodes=new Node[sources.Length];
        for(int i=0;i<nodes.Length;i++)
        {
            var source=sources[i];
            if(source.Parent>=i||source.Parent< -1)throw new InvalidOperationException("Return menu parents must precede their children.");
            var parent=source.Parent<0?root:nodes[source.Parent].Entity;
            var entity=World.CreateEntity(name+"/"+source.Id+"/"+source.Name,default,parent);
            var item=new Node{Entity=entity,Transform=entity.GetComponent<Transform>()};nodes[i]=item;
            item.Active=source.Active&&(source.Parent<0||nodes[source.Parent].Active);
            item.ButtonAncestor=source.Button is not null?i:source.Parent<0?-1:nodes[source.Parent].ButtonAncestor;
            entity.ActiveSelf=source.Active;
            item.Transform.LocalScale=new(source.ScaleX,source.ScaleY,source.ScaleZ);
            item.Transform.LocalRotationEuler=new(0,0,source.Rotation);
            var rect=entity.AddComponent<RectTransform>();
            rect.AnchorMin=new(source.AnchorMinX,source.AnchorMinY);
            rect.AnchorMax=new(source.AnchorMaxX,source.AnchorMaxY);
            rect.Pivot=new(source.PivotX,source.PivotY);
            rect.AnchoredPosition=new(source.X,source.Y);rect.SizeDelta=new(source.W,source.H);
            if(source.Image)
            {
                var image=entity.AddComponent<UIImage>();
                image.Image=new(source.Texture);image.Color=new(source.R,source.G,source.B,source.A);
                image.RaycastTarget=source.Raycast;image.PreserveAspect=source.PreserveAspect;
            }
            if(source.Text is not null)CreateText(entity,source);
            if(source.Button is not null)
            {
                item.Button=entity.AddComponent<UIButton>();
                item.Button.Interactable=false;
                // Main uses Animation; pause has no target graphic to tint.
                var white=new Color(1,1,1,1);
                item.Button.NormalColor=item.Button.HoverColor=item.Button.PressedColor=
                    item.Button.SelectedColor=item.Button.DisabledColor=white;
            }
        }
        canvasEntity.ActiveSelf=false;
    }

    static void CreateText(Entity entity,ReturnMenuNode source)
    {
        // Preserve Legacy Text's vertical alignment using a content rectangle;
        // this font's line height equals its em size. The source rectangle owns
        // raycasts, including the extra empty space around the visible glyphs.
        if(source.Raycast&&!source.Image)
        {
            var hit=entity.AddComponent<UIImage>();
            hit.Color=new(1,1,1,0);hit.RaycastTarget=true;
        }
        var content=World.CreateEntity("Legacy Text content",default,entity);
        // CreateEntity preserves world TRS; this adapter must instead inherit
        // its source Text's scale (not cancel the title/button parent scale).
        var transform=content.GetComponent<Transform>();
        transform.LocalScale=Vector3.One;transform.LocalRotationEuler=Vector3.Zero;
        int lines=1;foreach(char c in source.Text!)if(c=='\n')lines++;
        float anchorY=source.VerticalAlignment==0?1:source.VerticalAlignment==2?0:.5f;
        var rect=content.AddComponent<RectTransform>();
        rect.AnchorMin=new(0,anchorY);rect.AnchorMax=new(1,anchorY);rect.Pivot=new(.5f,anchorY);
        rect.AnchoredPosition=Vector2.Zero;rect.SizeDelta=new(0,source.FontSize*source.LineSpacing*lines);
        var label=content.AddComponent<UIText>();
        label.Font=new(source.Font);label.Text=source.Text!;label.FontSize=source.FontSize;
        label.Color=new(source.R,source.G,source.B,source.A);label.Alignment=(TextAlignment)source.Alignment;
        label.Wrap=source.Wrap;label.LineSpacing=source.LineSpacing;label.RaycastTarget=false;
    }

    public void SetVisible(bool value)
    {
        if(visible==value)return;
        visible=value;canvasEntity.ActiveSelf=value;
        foreach(var item in nodes)
        {
            if(item.Button is null)continue;
            item.Hovered=false;item.HoverTime=item.TransitionTime=0;item.FromFactor=1;
            if(item.Factor!=1)
            {
                int index=item.ButtonAncestor;var source=sources[index];
                item.Transform.LocalScale=new(source.ScaleX,source.ScaleY,source.ScaleZ);item.Factor=1;
            }
        }
    }

    public void EnableInput()
    {
        if(interactable)return;
        interactable=true;
        foreach(var item in nodes)if(item.Button is not null)item.Button.Interactable=true;
    }

    public ReturnMenuAction Tick(float width,float height,bool ready,float deltaTime)
    {
        if(!visible)return ReturnMenuAction.None;
        float nextScale=sourceScale*MathF.Min(width/DesignWidth,height/DesignHeight);
        if(nextScale!=scale){canvas.ScaleFactor=nextScale;scale=nextScale;}
        if(!ready||buttonCount==0)return ReturnMenuAction.None;
        var mouse=Input.MousePosition;
        int hovered=HitButton(width,height,mouse.X,height-mouse.Y);
        // Pressed and Selected clips have no scale curves in the original.
        bool pressed=Input.IsMouseButtonHeld(MouseButton.Left);
        float dt=Math.Clamp(deltaTime,0,.25f);
        for(int i=0;i<nodes.Length;i++)
        {
            var item=nodes[i];if(item.Button is null||!item.Active)continue;
            var source=sources[i];
            bool highlight=source.ButtonAnimation&&hovered==i&&!pressed;
            if(highlight!=item.Hovered)
            {
                item.Hovered=highlight;item.HoverTime=0;item.TransitionTime=0;item.FromFactor=item.Factor;
            }
            item.TransitionTime=MathF.Min(.25f,item.TransitionTime+dt);
            if(item.Hovered)item.HoverTime=(item.HoverTime+dt)%1;
            float phase=item.HoverTime<.5f?item.HoverTime*2:(1-item.HoverTime)*2;
            // Exact zero-tangent Hermite keys: .25 -> .30 -> .25 at 0/.5/1s.
            float target=item.Hovered?1+.2f*phase*phase*(3-2*phase):1;
            float factor=item.FromFactor+(target-item.FromFactor)*(item.TransitionTime/.25f);
            if(factor!=item.Factor)
            {
                item.Factor=factor;
                item.Transform.LocalScale=new(source.ScaleX*factor,source.ScaleY*factor,source.ScaleZ*factor);
            }
            ulong serial=item.Button.ClickSerial;
            if(serial!=item.ClickSerial)
            {
                item.ClickSerial=serial;
                Log.Info("[Return] ui:"+source.Button);
                return source.Button switch
                {
                    "start"=>ReturnMenuAction.Start,"resume"=>ReturnMenuAction.Resume,
                    "restart"=>ReturnMenuAction.Restart,"quit"=>ReturnMenuAction.Quit,
                    _=>ReturnMenuAction.None
                };
            }
        }
        return ReturnMenuAction.None;
    }

    int HitButton(float width,float height,float x,float y)
    {
        float designW=fitDesign?DesignWidth*scale/sourceScale:width,designH=fitDesign?DesignHeight*scale/sourceScale:height;
        var root=new Rect((width-designW)*.5f,(height-designH)*.5f,designW,designH);
        for(int i=0;i<nodes.Length;i++)
        {
            var item=nodes[i];var source=sources[i];
            var parent=source.Parent<0?root:nodes[source.Parent].Rect;
            float minX=parent.X+source.AnchorMinX*parent.W,minY=parent.Y+source.AnchorMinY*parent.H;
            float spanX=(source.AnchorMaxX-source.AnchorMinX)*parent.W,spanY=(source.AnchorMaxY-source.AnchorMinY)*parent.H;
            float w=MathF.Max(0,spanX+source.W*scale),h=MathF.Max(0,spanY+source.H*scale);
            float px=minX+spanX*source.PivotX+source.X*scale,py=minY+spanY*source.PivotY+source.Y*scale;
            item.Rect=new(px-w*source.PivotX,py-h*source.PivotY,w,h);
            float sin=MathF.Sin(source.Rotation),cos=MathF.Cos(source.Rotation);
            float a=cos*source.ScaleX*item.Factor,b=sin*source.ScaleX*item.Factor;
            float c=-sin*source.ScaleY*item.Factor,d=cos*source.ScaleY*item.Factor;
            var local=new Affine(a,b,c,d,px-a*px-c*py,py-b*px-d*py);
            item.Matrix=(source.Parent<0?Affine.Identity:nodes[source.Parent].Matrix).Then(local);
        }
        // Source graphics own the raycast, then bubble to their parent Button.
        // This retains the larger child Text hit area and source draw ordering.
        for(int i=nodes.Length-1;i>=0;i--)
        {
            var item=nodes[i];var source=sources[i];
            if(item.Active&&source.Raycast&&(source.Image||source.Text is not null)&&item.Matrix.Contains(item.Rect,x,y))
                return item.ButtonAncestor;
        }
        return -1;
    }
}
