using System;
namespace TomCatGame;

// Pure simulation: production and exploration share one bounded one-second clock.
public sealed class ShelterModel
{
    public readonly bool[] Buildings=new bool[25];
    readonly int[] production=new int[25];
    public static readonly int[] StormDays=[5,10,15,20,25,29];
    public static readonly int[] FoodNeeds=[8100,16200,36800,48000,59200,68160];
    public static readonly int[] DefenceNeeds=[40000,80000,162540,216540,270540,313740];
    public int Food=400,Wood=10,Stone=10,People=1,Defence,Seconds,Stage,Trip,Party,TripWood,TripStone;
    public bool Report,Storm,Result,Lost,Won;
    public int Day=>Storm||Result?NextStorm:Math.Min(29,Seconds/300+1);
    public int NextStorm=>StormDays[Math.Min(Stage,5)];
    public int Remaining=>NextStorm*300-Seconds;
    public int Version;
    public ShelterModel(){Buildings[12]=true;}
    public static int Ring(int i)=>Math.Max(Math.Abs(i%5-2),Math.Abs(i/5-2));
    public int Count(int ring){int n=0;for(int i=0;i<25;i++)if(Buildings[i]&&Ring(i)==ring)n++;return n;}
    public int Cost(int ring){int n=Count(ring);if(n<2)return n+1;int a=1,b=2;for(int i=0;i<n-1;i++){int c=(a+b)*(ring==1?5:2);a=b;b=c;}return b;}
    public bool Build(int i){if(i<0||i>=25||Buildings[i]||Result||Storm)return false;int r=Ring(i),cost=Cost(r);if(r==0||(r==1?Wood:Stone)<cost)return false;if(r==1)Wood-=cost;else Stone-=cost;Buildings[i]=true;production[i]=0;Version++;return true;}
    public bool Dispatch(int n){if(n<1||n>29||n>People||Food<n*200||Trip>0||Report||Result||Storm)return false;Party=n;People-=n;Food-=n*200;Trip=n*8+50;int total=(int)(n*Day*.8*Trip/.7);TripWood=(int)(total*.2);TripStone=total-TripWood;Version++;return true;}
    public bool Collect(){if(!Report||Result||Storm)return false;Wood+=TripWood;Stone+=TripStone;People+=Party+1;Party=0;Report=false;Version++;return true;}
    public void Tick(){if(Result||Storm)return;Seconds++;for(int i=0;i<25;i++)if(Buildings[i]&&Ring(i)>0&&++production[i]>=63){production[i]=0;if(Ring(i)==1)Food+=Day*60+3;else Defence+=Day*140+200;}
        if(Trip>0&&--Trip==0)Report=true;
        if(Seconds%300==0&&Seconds<NextStorm*300)Food-=People*200;
        // Original demo permits negative food between storms; retain that pressure.
        if(Seconds>=NextStorm*300)Storm=true;
        Version++;
    }
    public void ResolveStorm(){if(!Storm||Result)return;Storm=false;Result=true;Lost=Stage<5&&(Food<FoodNeeds[Stage]||Defence<DefenceNeeds[Stage]);Won=Stage==5;
        if(!Lost&&!Won){int losses=Stage==0?1:Stage==1?2:3;for(int r=1;r<=2;r++){int left=losses;for(int i=0;i<25&&left>0;i++)if(Buildings[i]&&Ring(i)==r){Buildings[i]=false;production[i]=0;left--;}}}Version++;
    }
    public void Continue(){if(!Result||Lost||Won)return;Result=false;Stage++;Food-=People*200;Version++;}
}
