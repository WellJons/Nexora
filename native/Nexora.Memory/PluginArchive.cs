using System.IO.Compression;
using System.Security.Cryptography;
using System.Text.RegularExpressions;

internal static class PluginArchive
{
    private const long MaxArchive=256L*1024*1024,MaxExtracted=512L*1024*1024;
    private const int MaxEntries=2048;
    private static readonly Regex Id=new(@"^[A-Za-z0-9_]{1,128}-[A-Za-z0-9_]{1,128}$");
    private static readonly Regex Reserved=new(@"^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)",RegexOptions.IgnoreCase);
    private static readonly HashSet<string> Meta=new(StringComparer.OrdinalIgnoreCase){"manifest.json","README.md","CHANGELOG.md","LICENSE","LICENSE.md","LICENSE.txt","icon.png","THUNDERSTORE.md"};
    private static readonly HashSet<string> Forbidden=new(StringComparer.OrdinalIgnoreCase){".exe",".com",".bat",".cmd",".ps1",".msi",".lnk",".url",".scr",".vbs",".js",".jse",".wsf",".hta",".reg",".sys",".cpl"};
    private static bool Exists(string p){try{File.GetAttributes(p);return true;}catch(FileNotFoundException){return false;}catch(DirectoryNotFoundException){return false;}}
    private static void Ordinary(string p,bool directory){
        var a=File.GetAttributes(p);if((a&FileAttributes.ReparsePoint)!=0||((a&FileAttributes.Directory)!=0)!=directory)throw new IOException("Unsupported link or file type: "+p);
    }
    private static string Root(string p){
        if(!Path.IsPathFullyQualified(p))throw new IOException("Select a BepInEx folder.");
        p=Path.TrimEndingDirectorySeparator(Path.GetFullPath(p));
        if(!Path.GetFileName(p).Equals("BepInEx",StringComparison.OrdinalIgnoreCase))throw new IOException("Select existing BepInEx folder, not the game root.");
        Ordinary(p,true);Ordinary(Path.Combine(p,"plugins"),true);
        return p;
    }
    private static string Package(string id){if(!Id.IsMatch(id)||id.Length>120)throw new IOException("Invalid package ID.");return id;}
    private static string Parent(string root,bool enabled,bool create){
        var p=enabled?Path.Combine(root,"plugins","Nexora-managed"):Path.Combine(root,"Nexora-disabled");
        if(create&&!Exists(p))Directory.CreateDirectory(p);
        if(Exists(p))Ordinary(p,true);return p;
    }
    private static string[] Paths(string root,string id,bool create=false)=>new[]{Path.Combine(Parent(root,true,create),id),Path.Combine(Parent(root,false,create),id)};
    private static string[] Parts(string name){
        if(name.Length>240||name.Contains('\\')||name.StartsWith('/')||name.Contains(':'))throw new IOException("Invalid ZIP path.");
        var parts=name.TrimEnd('/').Split('/');
        if(parts.Any(x=>x.Length==0||x=="."||x==".."||x.EndsWith('.')||x.EndsWith(' ')||x.StartsWith(' ')||Reserved.IsMatch(x)||x.Any(c=>c<32||"<>\"|?*".Contains(c))))throw new IOException("Invalid ZIP path.");
        return parts;
    }
    private sealed record Item(ZipArchiveEntry Entry,string Name);
    private static List<Item> Plan(ZipArchive zip){
        if(zip.Entries.Count<1||zip.Entries.Count>MaxEntries)throw new IOException("Too many ZIP entries.");
        var items=new List<Item>();var names=new HashSet<string>(StringComparer.OrdinalIgnoreCase);var paths=new List<(ZipArchiveEntry Entry,string[] Parts)>();long size=0;
        foreach(var e in zip.Entries){
            var p=Parts(e.FullName);
            int unixType=(e.ExternalAttributes>>16)&0xf000;
            if(unixType==0xa000||(e.ExternalAttributes&0x400)!=0)throw new IOException("Links in ZIP are not supported.");
            if(e.FullName.EndsWith('/'))continue;
            if(e.Length<0||e.Length>MaxExtracted||size>MaxExtracted-e.Length)throw new IOException("ZIP is too large.");size+=e.Length;
            paths.Add((e,p));
        }
        bool prefixed=paths.Any(x=>x.Parts.Length>1&&x.Parts[0].Equals("plugins",StringComparison.OrdinalIgnoreCase));
        bool nested=paths.Any(x=>x.Parts.Length>2&&x.Parts[0].Equals("BepInEx",StringComparison.OrdinalIgnoreCase)&&x.Parts[1].Equals("plugins",StringComparison.OrdinalIgnoreCase));
        if(prefixed&&nested)throw new IOException("Mixed plugin layout.");
        foreach(var (e,p) in paths){
            if(p.Length==1&&Meta.Contains(p[0]))continue;
            string[] relative;
            if(prefixed){if(p.Length<2||!p[0].Equals("plugins",StringComparison.OrdinalIgnoreCase))throw new IOException("Package requires manual installation (non-plugin files).");relative=p[1..];}
            else if(nested){if(p.Length<3||!p[0].Equals("BepInEx",StringComparison.OrdinalIgnoreCase)||!p[1].Equals("plugins",StringComparison.OrdinalIgnoreCase))throw new IOException("Package requires manual installation (non-plugin files).");relative=p[2..];}
            else {if(new[]{"BepInEx","config","patchers","core","doorstop","mono","winhttp.dll","doorstop_config.ini"}.Contains(p[0],StringComparer.OrdinalIgnoreCase))throw new IOException("Loader or patcher packages require manual installation.");relative=p;}
            var name=string.Join(Path.DirectorySeparatorChar,relative);
            if(Forbidden.Contains(Path.GetExtension(name))||!names.Add(name))throw new IOException("Unsupported or duplicate ZIP file.");
            items.Add(new(e,name));
        }
        if(!items.Any(x=>Path.GetExtension(x.Name).Equals(".dll",StringComparison.OrdinalIgnoreCase)))throw new IOException("No plugin DLL found; install this archive manually.");
        return items;
    }
    internal static object Install(string archive,string hash,long expectedSize,string selected,string package){
        if(!Regex.IsMatch(hash,@"^[a-fA-F0-9]{64}$")||expectedSize<=0||expectedSize>MaxArchive||!Path.GetExtension(archive).Equals(".zip",StringComparison.OrdinalIgnoreCase))throw new IOException("Invalid archive record.");
        string root=Root(selected),id=Package(package);Ordinary(archive,false);
        using var stream=new FileStream(archive,FileMode.Open,FileAccess.Read,FileShare.Read);
        if(stream.Length!=expectedSize||!Convert.ToHexString(SHA256.HashData(stream)).Equals(hash,StringComparison.OrdinalIgnoreCase))throw new IOException("Archive modified; download again.");
        stream.Position=0;using var zip=new ZipArchive(stream,ZipArchiveMode.Read,true);var entries=Plan(zip);
        var targets=Paths(root,id,true);if(targets.Any(Exists))throw new IOException("Package already exists. No files overwritten.");
        string stage=Path.Combine(root,".nexora-plugin-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(stage);
        try{
            var buffer=new byte[65536];long total=0;
            foreach(var item in entries){string dest=Path.Combine(stage,item.Name);Directory.CreateDirectory(Path.GetDirectoryName(dest)!);
                using var input=item.Entry.Open();using var output=new FileStream(dest,FileMode.CreateNew,FileAccess.Write,FileShare.None);
                long written=0;int n;while((n=input.Read(buffer,0,buffer.Length))>0){written+=n;total+=n;if(written>item.Entry.Length||total>MaxExtracted)throw new IOException("ZIP exceeds size limit.");output.Write(buffer,0,n);}if(written!=item.Entry.Length)throw new IOException("ZIP length mismatch.");
            }
            if(targets.Any(Exists))throw new IOException("Package appeared during install.");
            Directory.Move(stage,targets[0]);return new{folder=root,package=id,files=entries.Count,size=total};
        }finally{if(Directory.Exists(stage))Directory.Delete(stage,true);}
    }
    internal static string Status(string selected,string package){
        try{var p=Paths(Root(selected),Package(package));bool a=Exists(p[0]),b=Exists(p[1]);if(a)Ordinary(p[0],true);if(b)Ordinary(p[1],true);return a&&b?"conflict":a?"active":b?"disabled":"missing";}catch{return "conflict";}
    }
    internal static string Toggle(string selected,string package,bool enable){
        var p=Paths(Root(selected),Package(package),true);string from=p[enable?1:0],to=p[enable?0:1];Ordinary(from,true);if(Exists(to))throw new IOException("Destination exists; no files overwritten.");
        Directory.Move(from,to);return enable?"active":"disabled";
    }
    internal static bool SelfTest(){
        string dir=Path.Combine(Path.GetTempPath(),"nexora-zip-test-"+Guid.NewGuid().ToString("N"));
        try{
            string root=Path.Combine(dir,"BepInEx");Directory.CreateDirectory(Path.Combine(root,"plugins"));string zip=Path.Combine(dir,"test.zip");
            void Make(string name){if(File.Exists(zip))File.Delete(zip);using var arc=ZipFile.Open(zip,ZipArchiveMode.Create);using var w=new StreamWriter(arc.CreateEntry(name).Open());w.Write("test");}
            object Add(string id){using var s=File.OpenRead(zip);string hash=Convert.ToHexString(SHA256.HashData(s));long length=s.Length;s.Dispose();return Install(zip,hash,length,root,id);}
            Make("plugins/test.dll");Add("Team-Example");if(Status(root,"Team-Example")!="active"||Toggle(root,"Team-Example",false)!="disabled"||Toggle(root,"Team-Example",true)!="active")return false;
            Make("../escaped.dll");try{Add("Team-Bad");return false;}catch(IOException){}
            return !File.Exists(Path.Combine(dir,"escaped.dll"))&&File.Exists(Path.Combine(root,"plugins","Nexora-managed","Team-Example","test.dll"));
        }finally{Directory.Delete(dir,true);}
    }
}
