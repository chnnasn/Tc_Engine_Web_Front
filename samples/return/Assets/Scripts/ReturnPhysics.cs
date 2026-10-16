using System;

namespace TomCatGame;

// Fixed-step, allocation-free axis-separated platform collision. All coordinates
// and collider dimensions are in the source Unity scene's world units.
public readonly struct ReturnBounds(float x, float y, float w, float h)
{
    public readonly float X=x, Y=y, W=w, H=h;
    public float Left=>X-W*.5f;
    public float Right=>X+W*.5f;
    public float Bottom=>Y-H*.5f;
    public float Top=>Y+H*.5f;
    public bool Overlaps(ReturnBounds b, float inset=0) => Right>b.Left+inset&&Left<b.Right-inset&&Top>b.Bottom+inset&&Bottom<b.Top-inset;
}
public sealed class ReturnBody
{
    public float X,Y,PreviousX,PreviousY,VY,W,H,OffsetX,OffsetY;
    public bool Grounded,Enabled=true;
    public ReturnBounds Bounds=>new(X+OffsetX,Y+OffsetY,W,H);
    public ReturnBody(float x,float y,float w,float h,float ox=0,float oy=0)
    { X=PreviousX=x;Y=PreviousY=y;W=w;H=h;OffsetX=ox;OffsetY=oy; }
    public void Reset(float x,float y) { X=PreviousX=x;Y=PreviousY=y;VY=0;Grounded=false;Enabled=true; }
}
public static class ReturnPhysics
{
    public const float Step=1f/120, Gravity=49.05f, Speed=5, Jump=15;
    public static void Move(ReturnBody body,float dx,float dy,ReturnBounds[] solids,int solidCount,ReturnBody[] boxes,int boxCount,int self=-1,bool push=false,ReturnBody? verticalObstacle=null)
    {
        if(dx!=0)
        {
            float allowed=ClipX(body.Bounds,dx,solids,solidCount);
            for(int i=0;i<boxCount;i++)
            {
                if(i==self||!boxes[i].Enabled)continue;
                var other=boxes[i];float clipped=ClipX(body.Bounds,allowed,other.Bounds);
                if(push&&clipped!=allowed)
                {
                    float displacement=allowed-clipped;
                    Move(other,displacement,0,solids,solidCount,boxes,boxCount,i);
                    clipped=ClipX(body.Bounds,allowed,other.Bounds);
                }
                allowed=clipped;
            }
            body.X+=allowed;
        }
        body.Grounded=false;
        float vertical=ClipY(body.Bounds,dy,solids,solidCount);
        for(int i=0;i<boxCount;i++)if(i!=self&&boxes[i].Enabled)vertical=ClipY(body.Bounds,vertical,boxes[i].Bounds);
        // Falling boxes can rest on the player without allocating a temporary
        // collider array. Horizontal pushing and player movement stay unchanged.
        if(dy<0&&verticalObstacle is { Enabled:true })vertical=ClipY(body.Bounds,vertical,verticalObstacle.Bounds);
        if(vertical!=dy){body.Grounded=dy<0;body.VY=0;}
        body.Y+=vertical;
    }
    static float ClipX(ReturnBounds a,float amount,ReturnBounds b)
    {
        if(a.Top<=b.Bottom+.0001f||a.Bottom>=b.Top-.0001f)return amount;
        if(amount>0&&a.Right<=b.Left+.001f&&a.Right+amount>b.Left)return Math.Max(0,b.Left-a.Right);
        if(amount<0&&a.Left>=b.Right-.001f&&a.Left+amount<b.Right)return Math.Min(0,b.Right-a.Left);
        return amount;
    }
    static float ClipY(ReturnBounds a,float amount,ReturnBounds b)
    {
        if(a.Right<=b.Left+.0001f||a.Left>=b.Right-.0001f)return amount;
        if(amount>0&&a.Top<=b.Bottom+.001f&&a.Top+amount>b.Bottom)return Math.Max(0,b.Bottom-a.Top);
        if(amount<0&&a.Bottom>=b.Top-.001f&&a.Bottom+amount<b.Top)return Math.Min(0,b.Top-a.Bottom);
        return amount;
    }
    static float ClipX(ReturnBounds a,float d,ReturnBounds[] solids,int count){for(int i=0;i<count;i++)d=ClipX(a,d,solids[i]);return d;}
    static float ClipY(ReturnBounds a,float d,ReturnBounds[] solids,int count){for(int i=0;i<count;i++)d=ClipY(a,d,solids[i]);return d;}
}
