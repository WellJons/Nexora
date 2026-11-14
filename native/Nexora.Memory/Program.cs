using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text;
using System.Buffers.Binary;

internal static class Win
{
    internal const uint QueryReadWrite = 0x0400 | 0x0010 | 0x0020 | 0x0008;
    [StructLayout(LayoutKind.Sequential)]
    internal struct Region
    {
        public nint BaseAddress, AllocationBase;
        public uint AllocationProtect;
        public ushort PartitionId;
        public nuint RegionSize;
        public uint State, Protect, Type;
    }
    [DllImport("kernel32.dll", SetLastError=true)] internal static extern nint OpenProcess(uint access, bool inherit, int pid);
    [DllImport("kernel32.dll", SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] internal static extern bool CloseHandle(nint handle);
    [DllImport("kernel32.dll", SetLastError=true)] internal static extern nuint VirtualQueryEx(nint handle, nint address, out Region region, nuint length);
    [DllImport("kernel32.dll", SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] internal static extern bool ReadProcessMemory(nint handle, nint address, [Out] byte[] buffer, nuint size, out nuint read);
    [DllImport("kernel32.dll", SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] internal static extern bool WriteProcessMemory(nint handle, nint address, byte[] buffer, nuint size, out nuint written);
    [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] [return:MarshalAs(UnmanagedType.Bool)] internal static extern bool QueryFullProcessImageName(nint handle, uint flags, StringBuilder path, ref uint length);
    [DllImport("kernel32.dll", SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] internal static extern bool GetExitCodeProcess(nint handle, out uint exitCode);
    internal static bool Writable(Region r) => r.State==0x1000 && r.Type==0x20000 && (r.Protect & 0x100)==0 && (r.Protect & 0xff)==0x04;
    internal static bool Query(nint h, long a, out Region r) => VirtualQueryEx(h,(nint)a,out r,(nuint)Marshal.SizeOf<Region>())!=0;
    internal static string Image(nint h) { var s=new StringBuilder(32768);uint n=(uint)s.Capacity;if(!QueryFullProcessImageName(h,0,s,ref n))throw new Exception("Cannot verify game executable.");return s.ToString(); }
}

internal sealed class Scanner : IDisposable
{
    private const int HitLimit=50000, Chunk=1024*1024;
    private const long ByteLimit=512L*1024*1024;
    private nint handle;
    private readonly List<long> hits=new();
    private string kind="int32";
    private bool scanned, limited;
    private long readBytes;
    private int pid;
    private sealed record Watch(long Address,string Name,string Kind,int Bits,bool Frozen,long Expires);
    private readonly Dictionary<long,Watch> watches=new();
    private string watchMessage="";
    private long nextTick;
    private static readonly string[] BlockNames={"anticheat","anti-cheat","easyanticheat","battleye","beservice","vgc","vgk","start_protected_game","lsass","csrss","winlogon","services","svchost"};
    internal static bool Match(string image,string root,bool exact)
    {
        try {
            string p=Path.GetFullPath(image),r=Path.GetFullPath(root);
            if(!p.EndsWith(".exe",StringComparison.OrdinalIgnoreCase)||BlockNames.Any(s=>Path.GetFileNameWithoutExtension(p).Contains(s,StringComparison.OrdinalIgnoreCase)))return false;
            return exact?string.Equals(p,r,StringComparison.OrdinalIgnoreCase):p.StartsWith(Path.TrimEndingDirectorySeparator(r)+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase);
        } catch{return false;}
    }
    internal static object[] Processes(string root,bool exact)
    {
        var result=new List<object>();
        foreach(var p in Process.GetProcesses()) using(p) {try{
            string? image=p.MainModule?.FileName;
            if(image!=null&&p.Id!=Environment.ProcessId&&Match(image,root,exact))result.Add(new{pid=p.Id,name=p.ProcessName,image});
        }catch{}}
        return result.ToArray();
    }
    internal object Attach(int id,string root,bool exact)
    {
        Dispose();
        if(id<=4||id==Environment.ProcessId)throw new Exception("Select a running game.");
        using var p=Process.GetProcessById(id);
        string image=p.MainModule?.FileName??"";
        if(!Match(image,root,exact))throw new Exception("Process is outside the selected game's installation.");
        var h=Win.OpenProcess(Win.QueryReadWrite,false,id);
        if(h==0)throw new Exception("Windows denied access. Protected processes are not supported.");
        try{if(!Match(Win.Image(h),root,exact))throw new Exception("Process identity changed.");handle=h;pid=id;return new{pid=id,name=p.ProcessName};}
        catch{Win.CloseHandle(h);throw;}
    }
    private void Require(){if(handle==0)throw new Exception("No game session. Select a running game.");if(!Win.GetExitCodeProcess(handle,out var code)||code!=259){Dispose();throw new Exception("The game has exited. End the session and select it again.");}}
    internal static int Encode(string type,double v){
        if(!double.IsFinite(v))throw new Exception("Value must be finite.");
        return type switch {
            "int32" when v>=int.MinValue&&v<=int.MaxValue&&Math.Truncate(v)==v => (int)v,
            "float32" when v>=-float.MaxValue&&v<=float.MaxValue => BitConverter.SingleToInt32Bits((float)v),
            _ => throw new Exception("Value does not fit the selected type.")
        };
    }
    private bool Read(long address,out int bits)
    {
        bits=0;
        if(!Win.Query(handle,address,out var r)||!Win.Writable(r)||address<(long)r.BaseAddress||address-(long)r.BaseAddress>(long)r.RegionSize-4)return false;
        var b=new byte[4];if(!Win.ReadProcessMemory(handle,(nint)address,b,4,out var n)||n!=4)return false;
        bits=BinaryPrimitives.ReadInt32LittleEndian(b);return true;
    }
    internal static void Collect(byte[] buffer,int length,long start,int bits,List<long> result,int limit)
    {
        for(int i=0;i<=length-4&&result.Count<limit;i+=4)
            if(BinaryPrimitives.ReadInt32LittleEndian(buffer.AsSpan(i,4))==bits)result.Add(start+i);
    }
    internal object Scan(string type,double value)
    {
        Require();int bits=Encode(type,value);if(watches.Values.Any(w=>w.Frozen)){foreach(var a in watches.Keys.ToArray())watches[a]=watches[a] with{Frozen=false,Expires=0};watchMessage="Freeze stopped for a new search.";}kind=type;hits.Clear();scanned=false;limited=false;readBytes=0;
        var buffer=new byte[Chunk];long cursor=0;const long top=0x00007ffffffeffffL;
        while(cursor<top&&Win.Query(handle,cursor,out var page))
        {
            long start=(long)page.BaseAddress,len=(long)page.RegionSize;
            if(len<=0||start<0||len>long.MaxValue-start||start+len<=cursor)break;
            cursor=start+len;
            if(!Win.Writable(page))continue;
            for(long offset=0;offset+4<=len;){
                if(readBytes>=ByteLimit||hits.Count>=HitLimit){limited=true;break;}
                int count=(int)Math.Min(Math.Min(Chunk,len-offset),ByteLimit-readBytes);count-=count%4;if(count<4){limited=true;break;}
                readBytes+=count;
                Win.ReadProcessMemory(handle,(nint)(start+offset),buffer,(nuint)count,out var got);
                int actual=(int)Math.Min((ulong)got,(ulong)count);Collect(buffer,actual,start+offset,bits,hits,HitLimit);
                offset+=count;
                if(hits.Count>=HitLimit){limited=true;break;}
            }
            if(limited)break;
        }
        scanned=true;return Results();
    }
    internal object Refine(double value)
    {
        Require();if(!scanned)throw new Exception("Perform the first scan.");
        int bits=Encode(kind,value);hits.RemoveAll(a=>!Read(a,out var b)||b!=bits);return Results();
    }
    private long Selected(string address)
    {
        if(!long.TryParse(address,System.Globalization.NumberStyles.HexNumber,null,out var a)||!hits.Take(100).Contains(a))throw new Exception("Choose a displayed result first.");
        return a;
    }
    private static double Decode(string type,int bits)=>type=="int32"?(double)bits:BitConverter.Int32BitsToSingle(bits);
    private object[] WatchRows()
    {
        return watches.Values.Select(w=>{
            bool ok=Read(w.Address,out var actual);
            double v=ok?Decode(w.Kind,actual):double.NaN;
            return (object)new{address=w.Address.ToString("X"),name=w.Name,kind=w.Kind,value=double.IsFinite(v)?(double?)v:null,available=ok,frozen=w.Frozen,target=Decode(w.Kind,w.Bits),remaining=w.Frozen?Math.Max(0,(w.Expires-Environment.TickCount64)/1000):0};
        }).ToArray();
    }
    internal object Pin(string address,string name)
    {
        Require();var a=Selected(address);name=name.Trim();
        if(name.Length<1||name.Length>70)throw new Exception("Enter a name (1–70 characters).");
        if(watches.ContainsKey(a))throw new Exception("This address is already in the session.");
        if(watches.Count>=12)throw new Exception("A session supports up to 12 saved values.");
        if(!Read(a,out int bits)||!double.IsFinite(Decode(kind,bits)))throw new Exception("The value is unavailable.");
        watches.Add(a,new Watch(a,name,kind,bits,false,0));watchMessage="";return Results();
    }
    private Watch GetWatch(string address)
    {
        Require();
        if(!long.TryParse(address,System.Globalization.NumberStyles.HexNumber,null,out var a)||!watches.TryGetValue(a,out var w))throw new Exception("Unknown session value.");
        return w;
    }
    private void WriteBits(long a,int bits)
    {
        if(!Read(a,out _))throw new Exception("The value is no longer accessible.");
        var b=new byte[4];BinaryPrimitives.WriteInt32LittleEndian(b,bits);
        if(!Win.WriteProcessMemory(handle,(nint)a,b,4,out var n)||n!=4||!Read(a,out var actual)||actual!=bits)throw new Exception("The game did not retain the value.");
    }
    internal object SetWatch(string address,double value,bool freeze)
    {
        var w=GetWatch(address);int bits=Encode(w.Kind,value);
        WriteBits(w.Address,bits);watches[w.Address]=w with {Bits=bits,Frozen=freeze,Expires=freeze?Environment.TickCount64+300000:0};watchMessage="";return Results();
    }
    internal object StopWatch(string address)
    {
        var w=GetWatch(address);watches[w.Address]=w with{Frozen=false,Expires=0};return Results();
    }
    internal object RemoveWatch(string address)
    {
        var w=GetWatch(address);watches.Remove(w.Address);return Results();
    }
    internal object StopAll(){Require();foreach(var a in watches.Keys.ToArray())watches[a]=watches[a] with {Frozen=false,Expires=0};return Results();}
    internal void Tick()
    {
        if(handle==0||watches.Count==0)return;
        long now=Environment.TickCount64;if(now<nextTick)return;nextTick=now+400;
        if(!Win.GetExitCodeProcess(handle,out var code)||code!=259){Dispose();return;}
        foreach(var w in watches.Values.ToArray()){
            if(!w.Frozen)continue;
            if(now>=w.Expires){watches[w.Address]=w with {Frozen=false,Expires=0};watchMessage="Freeze expired. Enable it again if needed.";continue;}
            try{if(!Read(w.Address,out var bits))throw new Exception();if(bits!=w.Bits)WriteBits(w.Address,w.Bits);}
            catch{watches[w.Address]=w with {Frozen=false,Expires=0};watchMessage="A value became unavailable; its freeze stopped.";}
        }
    }
    internal object Results()
    {
        Require();var rows=new List<object>();
        foreach(long a in hits.Take(100)){if(Read(a,out var bits)){
            double v=kind=="int32"?(double)bits:BitConverter.Int32BitsToSingle(bits);
            rows.Add(new {address=a.ToString("X"),value=double.IsFinite(v)?(double?)v:null});
        }}
        return new{pid,kind,total=hits.Count,limited,readBytes,rows,scanned,watches=WatchRows(),watchMessage};
    }
    internal object Write(string address,double value)
    {
        Require();if(!long.TryParse(address,System.Globalization.NumberStyles.HexNumber,null,out var a)||!hits.Contains(a)||!hits.Take(100).Contains(a))throw new Exception("Choose an address from the displayed results.");
        int bits=Encode(kind,value);if(!Read(a,out _))throw new Exception("The value is no longer accessible.");
        if(watches.TryGetValue(a,out var w)&&w.Frozen)throw new Exception("Disable its freeze first.");
        WriteBits(a,bits);
        return Results();
    }
    internal static bool SelfTestWatch()
    {
        using var test=new Scanner();
        nint ptr=Marshal.AllocHGlobal(4);
        try{
            test.handle=Win.OpenProcess(Win.QueryReadWrite,false,Environment.ProcessId);
            if(test.handle==0)return false;
            Marshal.WriteInt32(ptr,13);test.hits.Add((long)ptr);test.scanned=true;
            string address=((long)ptr).ToString("X");
            test.Pin(address,"test");
            test.SetWatch(address,42,true);
            if(Marshal.ReadInt32(ptr)!=42)return false;
            Marshal.WriteInt32(ptr,7);test.Tick();
            if(Marshal.ReadInt32(ptr)!=42)return false;
            test.StopWatch(address);Marshal.WriteInt32(ptr,8);test.nextTick=0;test.Tick();
            if(Marshal.ReadInt32(ptr)!=8)return false;
            test.RemoveWatch(address);return test.watches.Count==0;
        }finally{test.Dispose();Marshal.FreeHGlobal(ptr);}
    }
    public void Dispose(){if(handle!=0)Win.CloseHandle(handle);handle=0;pid=0;hits.Clear();watches.Clear();watchMessage="";scanned=false;limited=false;readBytes=0;}
}

internal static class WindowInfo
{
    [StructLayout(LayoutKind.Sequential)] private struct Rect { public int left,top,right,bottom; }
    [DllImport("user32.dll")] private static extern nint GetForegroundWindow();
    [DllImport("user32.dll")] [return:MarshalAs(UnmanagedType.Bool)] private static extern bool IsWindow(nint h);
    [DllImport("user32.dll")] [return:MarshalAs(UnmanagedType.Bool)] private static extern bool IsIconic(nint h);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(nint h,out uint pid);
    [DllImport("dwmapi.dll")] private static extern int DwmGetWindowAttribute(nint h,uint attribute,out Rect rect,uint size);
    internal static object Get(string raw){
        if(!long.TryParse(raw,out var id)||id<=0)throw new Exception("Invalid window");
        nint h=(nint)id;if(!IsWindow(h))return new{exists=false};
        GetWindowThreadProcessId(h,out uint pid);
        if(pid==0||DwmGetWindowAttribute(h,9,out var r,(uint)Marshal.SizeOf<Rect>())!=0||r.right<=r.left||r.bottom<=r.top)return new{exists=false};
        return new{exists=true,pid,foreground=GetForegroundWindow()==h&&!IsIconic(h),bounds=new{x=r.left,y=r.top,width=r.right-r.left,height=r.bottom-r.top}};
    }
}
internal static class Program
{
    private static string S(JsonElement j,string key)=>j.GetProperty(key).GetString()??throw new Exception("Missing "+key);
    private static double N(JsonElement j,string key)=>j.GetProperty(key).GetDouble();
    private static int Main(string[] args)
    {
        if(!OperatingSystem.IsWindows()||!Environment.Is64BitProcess)return 2;
        if(args.Length==2&&args[0]=="--uninstall-cleanup"&&(args[1]=="keep"||args[1]=="purge-backups"))return Cleanup.Run(args[1]=="purge-backups");
        if(args.Length==1&&args[0]=="--self-test"){
            if(Marshal.SizeOf<Win.Region>()!=48||Scanner.Encode("int32",int.MaxValue)!=int.MaxValue||Scanner.Encode("float32",1.5)!=BitConverter.SingleToInt32Bits(1.5f))return 3;
            var buffer=new byte[12];BinaryPrimitives.WriteInt32LittleEndian(buffer.AsSpan(4),123456);var list=new List<long>();Scanner.Collect(buffer,12,100,123456,list,10);if(list.Count!=1||list[0]!=104)return 4;
            if(Scanner.Match(@"C:\games2\test.exe",@"C:\games",false)||!Scanner.Match(@"C:\games\test.exe",@"C:\games",false)||Scanner.Match(@"C:\games\EasyAntiCheat.exe",@"C:\games",false))return 5;
            nint ptr=Marshal.AllocHGlobal(4),h=Win.OpenProcess(Win.QueryReadWrite,false,Environment.ProcessId);
            try{if(h==0)return 6;Marshal.WriteInt32(ptr,13);var b=new byte[4];if(!Win.ReadProcessMemory(h,ptr,b,4,out var r)||r!=4||BitConverter.ToInt32(b)!=13)return 7;if(!Win.WriteProcessMemory(h,ptr,BitConverter.GetBytes(42),4,out var w)||w!=4||Marshal.ReadInt32(ptr)!=42)return 8;}finally{if(h!=0)Win.CloseHandle(h);Marshal.FreeHGlobal(ptr);}
            if(!Scanner.SelfTestWatch())return 9;
            if(!Cleanup.SelfTest())return 10;
            if(!PlaySession.SelfTest())return 15;
            if(!PluginArchive.SelfTest())return 16;
            if(!Gk2Live.Valid("energy",100)||Gk2Live.Valid("unknown",1)||Gk2Live.Valid("tech_red",1.5)||Gk2Live.Valid("money",double.NaN))return 17;
            Console.WriteLine("Nexora native self-test passed.");return 0;
        }
        using var scanner=new Scanner();
        using var play=new PlaySession();
        using var gk2=new Gk2Live();
        while(true){
            var input=Task.Run(()=>Console.ReadLine());
            while(!input.Wait(400)){scanner.Tick();play.Tick();gk2.Tick();}
            string? line=input.GetAwaiter().GetResult();
            if(line==null)break;
            scanner.Tick();play.Tick();gk2.Tick();
            try{
            if(line.Length>32768)throw new Exception("Request too large.");
            using var doc=JsonDocument.Parse(line);var j=doc.RootElement;
            object? data=S(j,"op") switch {
                "gk2-start"=>gk2.Start(S(j,"root"),j.GetProperty("exact").GetBoolean()),
                "gk2-state"=>gk2.Snapshot(),
                "gk2-set"=>gk2.Change(S(j,"key"),N(j,"value"),j.GetProperty("hold").GetBoolean()),
                "gk2-release"=>gk2.Release(S(j,"key")),
                "console-send"=>ConsoleInput.Send(S(j,"root"),j.GetProperty("exact").GetBoolean(),S(j,"profile"),S(j,"command")),
                "window-info"=>WindowInfo.Get(S(j,"handle")),
                "plugin-install"=>PluginArchive.Install(S(j,"archive"),S(j,"sha256"),j.GetProperty("size").GetInt64(),S(j,"folder"),S(j,"package")),
                "plugin-status"=>PluginArchive.Status(S(j,"folder"),S(j,"package")),
                "plugin-toggle"=>PluginArchive.Toggle(S(j,"folder"),S(j,"package"),j.GetProperty("enabled").GetBoolean()),
                "play-start"=>play.Start(j.GetProperty("pid").GetInt32(),S(j,"root"),j.GetProperty("exact").GetBoolean(),j.GetProperty("boost").GetBoolean()),
                "play-sample"=>play.Sample(),
                "play-stop"=>play.Stop(),
                "list"=>Scanner.Processes(S(j,"root"),j.GetProperty("exact").GetBoolean()),
                "attach"=>scanner.Attach(j.GetProperty("pid").GetInt32(),S(j,"root"),j.GetProperty("exact").GetBoolean()),
                "scan"=>scanner.Scan(S(j,"kind"),N(j,"value")),
                "refine"=>scanner.Refine(N(j,"value")),
                "results"=>scanner.Results(),
                "write"=>scanner.Write(S(j,"address"),N(j,"value")),
                "pin"=>scanner.Pin(S(j,"address"),S(j,"name")),
                "watch-set"=>scanner.SetWatch(S(j,"address"),N(j,"value"),j.GetProperty("freeze").GetBoolean()),
                "watch-stop"=>scanner.StopWatch(S(j,"address")),
                "watch-remove"=>scanner.RemoveWatch(S(j,"address")),
                "stop-all"=>scanner.StopAll(),
                "detach"=>Detach(scanner),
                _=>throw new Exception("Unknown operation.")
            };
            Console.WriteLine(JsonSerializer.Serialize(new{ok=true,data}));
        }catch(Exception e){Console.WriteLine(JsonSerializer.Serialize(new{ok=false,error=e.Message}));}}
        return 0;
    }
    private static object Detach(Scanner s){s.Dispose();return new{detached=true};}
}
