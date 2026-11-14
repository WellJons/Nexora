using System.Runtime.InteropServices;
using System.Text.Json;
using System.Security.Cryptography;

internal static class Program
{
    private static int Main()
    {
        // An owned private allocation, never a game or system process.
        nint gold=Marshal.AllocHGlobal(4), health=Marshal.AllocHGlobal(4);
        try{
            Marshal.WriteInt32(gold,RandomNumberGenerator.GetInt32(100000000,200000000));
            Marshal.WriteInt32(health,100);
            Console.WriteLine(JsonSerializer.Serialize(new{ready=true,pid=Environment.ProcessId,goldAddress=((long)gold).ToString("X"),healthAddress=((long)health).ToString("X")}));
            string? line;
            while((line=Console.ReadLine())!=null){
                if(line=="quit")break;
                if(line=="earn")Marshal.WriteInt32(gold,Math.Min(999999999,Marshal.ReadInt32(gold)+137));
                else if(line=="hit")Marshal.WriteInt32(health,Math.Max(0,Marshal.ReadInt32(health)-17));
                else if(line=="heal")Marshal.WriteInt32(health,100);
                else if(line!="status"){Console.WriteLine("{\"ok\":false}");continue;}
                Console.WriteLine(JsonSerializer.Serialize(new{ok=true,gold=Marshal.ReadInt32(gold),health=Marshal.ReadInt32(health)}));
            }
            return 0;
        }finally{Marshal.FreeHGlobal(gold);Marshal.FreeHGlobal(health);}
    }
}
