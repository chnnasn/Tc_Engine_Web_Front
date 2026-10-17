using TomCatGame;
static void Check(bool ok,string name){if(!ok)throw new Exception(name);Console.WriteLine("PASS "+name);}
var m=new ShelterModel();
Check(m.Food==400&&m.Wood==10&&m.Stone==10&&m.People==1&&m.Day==1,"source initial state");
Check(!m.Build(-1)&&!m.Build(25)&&!m.Build(12),"invalid and occupied cells");
Check(m.Build(7)&&m.Wood==9&&!m.Build(7)&&m.Wood==9,"build once, debit once");
Check(m.Cost(1)==2&&m.Build(6)&&m.Cost(1)==15,"source cost recurrence");
Check(!m.Build(8)&&m.Wood==7,"insufficient resources atomic");
Check(!m.Dispatch(0)&&!m.Dispatch(30)&&m.Dispatch(1)&&!m.Dispatch(1),"dispatch guards");
Check(m.Trip==58&&m.TripWood==13&&m.TripStone==53&&m.People==0&&m.Food==200,"source exploration formula");
for(int i=0;i<58;i++)m.Tick();Check(m.Report&&m.Collect()&&m.People==2&&m.Wood==20&&m.Stone==63&&!m.Collect(),"one-time exploration receipt");
var food=m.Food;for(int i=58;i<63;i++)m.Tick();Check(m.Food==food+126,"two farm production");
var empty=new ShelterModel();while(!empty.Storm)empty.Tick();Check(empty.Day==5&&empty.Seconds==1500,"storm boundary clock");empty.ResolveStorm();Check(empty.Lost&&empty.Result&&!empty.Won,"failure branch");var sec=empty.Seconds;empty.Tick();empty.Continue();Check(empty.Seconds==sec&&empty.Stage==0,"failed run frozen");
// Six-stage success/destruction boundaries with explicitly synthetic reserves.
var victory=new ShelterModel(){Food=10000000,Defence=10000000,Wood=10000000,Stone=10000000};for(int i=0;i<25;i++)victory.Build(i);
for(int s=0;s<6;s++){while(!victory.Storm)victory.Tick();Check(victory.Day==ShelterModel.StormDays[s],"storm day "+s);int f=victory.Count(1),w=victory.Count(2);victory.ResolveStorm();Check(!victory.Lost,"success "+s);if(s<5){int n=Math.Min(3,s+1);Check(victory.Count(1)==Math.Max(0,f-n)&&victory.Count(2)==Math.Max(0,w-n),"unique destruction "+s);victory.Continue();}}
Check(victory.Won&&victory.Result&&victory.Day==29,"original final victory");
// End-to-end resource strategy, original reserves, no injected resources.
var play=new ShelterModel();int ticks=0;
while(!play.Won&&!play.Lost&&ticks++<10000){
 if(play.Report)play.Collect();
 for(int r=1;r<=2;r++)for(int i=0;i<25;i++)if(ShelterModel.Ring(i)==r&&play.Count(r)<(r==1?4:4))play.Build(i);
 if(play.Trip==0&&!play.Report&&(play.Count(1)<4||play.Count(2)<4))play.Dispatch(Math.Min(Math.Min(play.People,29),Math.Max(0,play.Food/400)));
 play.Tick();if(play.Storm){Console.WriteLine($"stage={play.Stage} food={play.Food} defense={play.Defence} farms={play.Count(1)} walls={play.Count(2)}");play.ResolveStorm();play.Continue();}
}
Check(play.Won,"all six stages playable from original resources");
Console.WriteLine("Shelter simulation complete");
