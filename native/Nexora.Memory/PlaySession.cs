using System.Diagnostics;
using System.Runtime.InteropServices;

internal sealed class PlaySession : IDisposable
{
    private const uint Query=0x1000,Set=0x0200,Normal=0x20,AboveNormal=0x8000;
    [DllImport("kernel32.dll",SetLastError=true)] private static extern uint GetPriorityClass(nint h);
    [DllImport("kernel32.dll",SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] private static extern bool SetPriorityClass(nint h,uint priority);
    [DllImport("kernel32.dll",SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] private static extern bool GetProcessTimes(nint h,out long created,out long exited,out long kernel,out long user);
    private nint handle;
    private int pid;
    private readonly Stopwatch watch=new();
    private bool boosted;
    private string warning="";
    private bool Alive()=>handle!=0&&Win.GetExitCodeProcess(handle,out uint code)&&code==259;
    private static string Priority(uint p)=>p switch{Normal=>"normal",AboveNormal=>"above-normal",0x40=>"idle",0x4000=>"below-normal",0x80=>"high",0x100=>"realtime",_=>"unknown"};
    internal object Start(int id,string root,bool exact,bool boost)
    {
        if(handle!=0)throw new Exception("A session is already active.");
        if(id<=4||id==Environment.ProcessId)throw new Exception("Select a game process.");
        nint h=Win.OpenProcess(Query|(boost?Set:0),false,id);
        if(h==0)throw new Exception("Access denied; try tracking without priority change.");
        try{
            if(!Scanner.Match(Win.Image(h),root,exact)||!Win.GetExitCodeProcess(h,out uint code)||code!=259)throw new Exception("Game identity changed.");
            handle=h;pid=id;warning="";watch.Restart();
            if(boost){
                uint current=GetPriorityClass(h);
                if(current==Normal){if(SetPriorityClass(h,AboveNormal))boosted=true;else warning="Windows did not allow a priority change.";}
                else warning="Priority was not Normal; it was left unchanged.";
            }
            return Sample();
        }catch{if(handle==h)End();else Win.CloseHandle(h);throw;}
    }
    private void Restore()
    {
        if(!boosted)return;
        boosted=false;
        if(Alive()&&GetPriorityClass(handle)==AboveNormal&&!SetPriorityClass(handle,Normal))
            warning="Could not restore game priority; restore Normal in Task Manager or close the game.";
    }
    internal void Tick(){if(handle==0)return;if(!Alive()){watch.Stop();Restore();}else if(watch.Elapsed>=TimeSpan.FromMinutes(30))Restore();}
    internal object Sample()
    {
        if(handle==0)throw new Exception("No tracked process.");
        bool running=Alive();if(!running){Restore();watch.Stop();}
        Tick();double? cpu=null;if(GetProcessTimes(handle,out _,out _,out long kernel,out long user))cpu=(kernel+user)/10000000.0;
        return new{running,pid,seconds=Math.Floor(watch.Elapsed.TotalSeconds),cpuSeconds=cpu,priority=Priority(GetPriorityClass(handle)),boosted,warning};
    }
    internal object Stop(){var before=Sample();Restore();string w=warning;End();return new{sample=before,warning=w};}
    private void End(){Restore();if(handle!=0)Win.CloseHandle(handle);handle=0;pid=0;watch.Stop();}
    public void Dispose()=>End();
    internal static bool SelfTest(){
        using var session=new PlaySession();
        using var process=Process.GetCurrentProcess();
        // Fixture only: observe our own executable through a read-only handle, no priority change.
        nint h=Win.OpenProcess(Query,false,process.Id);if(h==0)return false;
        session.handle=h;session.pid=process.Id;session.watch.Start();
        bool ok=session.Alive()&&GetProcessTimes(h,out _,out _,out _,out _);
        session.Stop();return ok&&session.handle==0;
    }
}
