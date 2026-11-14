using System.Runtime.InteropServices;
using System.Text.RegularExpressions;

internal static class ConsoleInput
{
    [StructLayout(LayoutKind.Sequential)] private struct Key { public ushort vk,scan;public uint flags,time;public nuint extra; }
    [StructLayout(LayoutKind.Explicit,Size=32)] private struct Union { [FieldOffset(0)] public Key keyboard; }
    [StructLayout(LayoutKind.Sequential)] private struct Input { public uint type;public Union data; }
    [DllImport("user32.dll")] private static extern nint GetForegroundWindow();
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(nint h,out uint pid);
    [DllImport("user32.dll")] private static extern nint GetKeyboardLayout(uint thread);
    [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] private static extern short VkKeyScanEx(char c,nint layout);
    [DllImport("user32.dll")] private static extern uint SendInput(uint count,Input[] inputs,int size);
    private static bool Down(int v)=>(GetAsyncKeyState(v)&0x8000)!=0;
    private static Input Event(ushort key,bool up)=>new(){type=1,data=new Union{keyboard=new Key{vk=key,flags=up?2u:0u}}};
    internal static object Send(string root,bool exact,string profile,string command)
    {
        // Only the exact known game executable in the selected installation; no background input or memory changes.
        if(!Regex.IsMatch(command,@"\A(?:tgm|tcl|player\.resethealth|player\.additem [0-9a-fA-F]{8} [0-9]{1,5})\z",RegexOptions.CultureInvariant))throw new Exception("Command not supported.");
        string[] names=profile switch{"skyrim"=>new[]{"SkyrimSE.exe","TESV.exe"},"fallout4"=>new[]{"Fallout4.exe"},_=>throw new Exception("Unsupported game.")};
        nint hwnd=GetForegroundWindow();uint thread=GetWindowThreadProcessId(hwnd,out uint pid);
        if(hwnd==0||pid<=4||thread==0)throw new Exception("Game must be in foreground.");
        nint h=Win.OpenProcess(0x1000,false,(int)pid);if(h==0)throw new Exception("Cannot verify foreground game.");
        try{
            string image=Win.Image(h);if(!Scanner.Match(image,root,exact)||!names.Contains(Path.GetFileName(image),StringComparer.OrdinalIgnoreCase))throw new Exception("Open the selected game and its console first.");
            for(int i=0;i<50&&(Down(0x10)||Down(0x11)||Down(0x12)||Down(0x77)||Down(0x5B)||Down(0x5C));i++)Thread.Sleep(20);
            if(Down(0x10)||Down(0x11)||Down(0x12)||Down(0x77)||Down(0x5B)||Down(0x5C))throw new Exception("Release shortcut keys first.");
            var layout=GetKeyboardLayout(thread);if((layout.ToInt64()&0xffff)!=0x0409)throw new Exception("Switch game keyboard layout to English (US).");
            var inputs=new List<Input>();bool caps=(GetKeyState(0x14)&1)!=0;
            foreach(char c in command){
                short k=VkKeyScanEx(c,layout);if(k==-1||((k>>8)&~1)!=0)throw new Exception("Unsupported keyboard layout.");
                bool shift=((k>>8)&1)!=0;if((c>='a'&&c<='z')||(c>='A'&&c<='Z'))shift^=caps;
                if(shift)inputs.Add(Event(0x10,false));inputs.Add(Event((ushort)(k&255),false));inputs.Add(Event((ushort)(k&255),true));if(shift)inputs.Add(Event(0x10,true));
            }
            // Deliberately no Enter: player verifies the command in the already-open console, then executes.
            if(GetForegroundWindow()!=hwnd||!Win.GetExitCodeProcess(h,out uint code)||code!=259)throw new Exception("Game focus changed.");
            if(SendInput((uint)inputs.Count,inputs.ToArray(),Marshal.SizeOf<Input>())!=(uint)inputs.Count)throw new Exception("Windows did not accept all input. Clear any partial command.");
            return new{sent=true,pid,requiresEnter=true};
        }finally{Win.CloseHandle(h);}
    }
    [DllImport("user32.dll")] private static extern short GetKeyState(int key);
}
