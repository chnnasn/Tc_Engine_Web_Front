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
    // Scene loading and realm changes can activate geometry already overlapping
    // a body. Sweeps only prevent new intersections; separate these existing
    // contacts once when the solid set changes, preserving the authored spawn.
    public static void ResolveStaticOverlaps(ReturnBody body,ReturnBounds[] solids,int solidCount)
    {
        if(!body.Enabled)return;
        var original=body.Bounds;
        if(!OverlapsSolids(original,solids,solidCount))return;
        float bestDistance=float.PositiveInfinity,bestX=0,bestY=0;
        // The nearest free AABB touches one or more obstacle edges. Test their
        // X/Y boundary combinations against the whole solid set. This handles
        // corners without alternating between a platform and the floor below.
        // Distance pruning keeps the common shallow-contact case small.
        for(int xi=0;xi<=solidCount*2;xi++)
        {
            float x=xi==0?0:xi%2==1?solids[(xi-1)/2].Left-original.Right:solids[(xi-1)/2].Right-original.Left;
            if(x*x>=bestDistance)continue;
            for(int yi=0;yi<=solidCount*2;yi++)
            {
                float y=yi==0?0:yi%2==1?solids[(yi-1)/2].Bottom-original.Top:solids[(yi-1)/2].Top-original.Bottom;
                float distance=x*x+y*y;
                if(distance>=bestDistance)continue;
                var candidate=new ReturnBounds(original.X+x,original.Y+y,original.W,original.H);
                if(OverlapsSolids(candidate,solids,solidCount))continue;
                bestX=x;bestY=y;bestDistance=distance;
            }
        }
        body.X+=bestX;body.Y+=bestY;
        if(bestY*body.VY<0)body.VY=0;
        if(bestY!=0)body.Grounded=bestY>0;
        // A correction is discontinuous, so interpolation must start outside
        // the solid instead of briefly drawing the original embedded position.
        body.PreviousX=body.X;body.PreviousY=body.Y;
    }
    static bool OverlapsSolids(ReturnBounds body,ReturnBounds[] solids,int count)
    { for(int i=0;i<count;i++)if(body.Overlaps(solids[i],.00001f))return true;return false; }
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
