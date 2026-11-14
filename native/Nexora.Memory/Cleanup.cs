using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Nodes;

internal static class Cleanup
{
    private static readonly string[] Owned = {
        "translation-models","scratch","updates","trainer-packages","Cache","Code Cache","GPUCache","DawnCache","DawnGraphiteCache","DawnWebGPUCache","Dictionaries","Network","Local Storage","Session Storage","IndexedDB","blob_storage","Crashpad","logs","WebStorage","SharedStorage","Service Worker","File System","databases","Partitions","VideoDecodeStats",
        "Preferences","Local State","SingletonLock","SingletonCookie","SingletonSocket","DevToolsActivePort","Cookies","Cookies-journal","TransportSecurity","Visited Links","Trust Tokens","Trust Tokens-journal","DIPS","DIPS-wal","DIPS-shm","SharedStorage-wal","SharedStorage-shm","library.json.tmp","game-profiles-cache.json","trainer-source-index.json","trainer-source-index.json.tmp","trainer-source-index-v2.json","trainer-source-index-v2.json.tmp","LOCK","LOG","LOG.old"
    };
    private static bool Reparse(string file) => (File.GetAttributes(file)&FileAttributes.ReparsePoint)!=0;
    private static bool Exists(string file) {try{File.GetAttributes(file);return true;}catch(FileNotFoundException){return false;}catch(DirectoryNotFoundException){return false;}}
    private static bool Inside(string root,string candidate) {
        string a=Path.TrimEndingDirectorySeparator(Path.GetFullPath(root)),b=Path.GetFullPath(candidate);
        return b.Equals(a,StringComparison.OrdinalIgnoreCase)||b.StartsWith(a+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase);
    }
    // Do not traverse reparse points, including directory junctions. Unknown objects stay on disk.
    private static void DeleteTree(string p) {
        if(!Exists(p))return;
        var attrs=File.GetAttributes(p);if((attrs&FileAttributes.ReparsePoint)!=0)throw new IOException("Link retained: "+p);
        if((attrs&FileAttributes.Directory)!=0){foreach(string e in Directory.EnumerateFileSystemEntries(p))DeleteTree(e);Directory.Delete(p);}
        else{if((attrs&FileAttributes.ReadOnly)!=0)File.SetAttributes(p,attrs&~FileAttributes.ReadOnly);File.Delete(p);}
    }
    internal static int Run(bool purge) {
        try{
            foreach(var p in Process.GetProcessesByName("Nexora"))using(p){if(!p.HasExited)return 11;}
            string parent=Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            if(string.IsNullOrWhiteSpace(parent))return 12;
            return Remove(Path.Combine(parent,"Nexora"),purge);
        }catch{return 12;}
    }
    internal static int Remove(string root,bool purge) {
        if(!Exists(root))return 0;
        if(Reparse(root)||!Directory.Exists(root))return 12;
        string library=Path.Combine(root,"library.json"),index=Path.Combine(root,"backup-index.json"),backups=Path.Combine(root,"backups");
        JsonNode? state=null;bool invalid=false;var protectedPaths=new List<string>();int warnings=0;
        if(Exists(library)){try{if(Reparse(library))throw new IOException();state=JsonNode.Parse(File.ReadAllText(library));if(state is not JsonObject)throw new IOException();}catch{invalid=true;warnings++;}}
        // Preserve user-selected download paths, installed mod folders and source saves, even if nested in a managed directory.
        if(state is JsonObject){foreach(var (key,field) in new[]{("downloads","path"),("installedMods","folder"),("manual","path"),("backups","source")}){
            if(state[key] is JsonArray rows)foreach(var row in rows){try{string? p=row?[field]?.GetValue<string>();if(!string.IsNullOrEmpty(p)&&Path.IsPathFullyQualified(p)&&Inside(root,p))protectedPaths.Add(Path.GetFullPath(p));}catch{warnings++;invalid=true;}}
        }}
        if(invalid)return 13; // A damaged index might contain user-owned destinations. Fail closed.
        bool Protected(string p)=>protectedPaths.Any(v=>Inside(p,v)||Inside(v,p));
        // Keep the original internal backup paths and a minimal index. A later installation can recover it.
        if(!purge&&state?["backups"] is JsonArray list&&list.Count>0){
            try{
                if(Exists(index)&&Reparse(index))throw new IOException("Index linked");
                var retained=new JsonArray();foreach(var row in list)if(row!=null)retained.Add(row.DeepClone());
                if(Exists(index)){var old=JsonNode.Parse(File.ReadAllText(index)) as JsonArray;if(old!=null){var ids=new HashSet<string>(retained.Select(x=>x?["id"]?.ToString()??""));foreach(var row in old)if(row!=null&&ids.Add(row["id"]?.ToString()??""))retained.Add(row.DeepClone());}}
                string tmp=Path.Combine(root,"backup-index."+Guid.NewGuid().ToString("N")+".tmp");
                File.WriteAllText(tmp,retained.ToJsonString());File.Move(tmp,index,true);
            }catch{return 13;}
        }
        foreach(string name in Owned){
            string p=Path.Combine(root,name);if(Protected(p)){warnings++;continue;}try{DeleteTree(p);}catch{warnings++;}
        }
        if(purge){foreach(string p in new[]{backups,index}){if(Protected(p)){warnings++;continue;}try{DeleteTree(p);}catch{warnings++;}}}
        // Keep path metadata if any cleanup failed, so later runs cannot forget protected paths.
        if(warnings==0&&!Protected(library)){try{DeleteTree(library);}catch{warnings++;}}else if(Protected(library))warnings++;
        // Unknown user files and retained backups are never recursively removed.
        try{if(!Directory.EnumerateFileSystemEntries(root).Any())Directory.Delete(root);}catch{warnings++;}
        return warnings==0?0:14;
    }
    internal static bool SelfTest() {
        string root=Path.Combine(Path.GetTempPath(),"nexora-cleanup-test-"+Guid.NewGuid().ToString("N"));
        try{
            string user=Path.Combine(root,"Nexora"),mod=Path.Combine(root,"mods"),keep=Path.Combine(user,"backups","save-demo","files");
            Directory.CreateDirectory(keep);Directory.CreateDirectory(mod);Directory.CreateDirectory(Path.Combine(user,"translation-models"));Directory.CreateDirectory(Path.Combine(user,"Cache"));Directory.CreateDirectory(Path.Combine(user,"scratch"));
            File.WriteAllText(Path.Combine(keep,"save.dat"),"save");File.WriteAllText(Path.Combine(mod,"mod.jar"),"mod");File.WriteAllText(Path.Combine(user,"translation-models","model.onnx"),"model");File.WriteAllText(Path.Combine(user,"Cache","cache"),"cache");File.WriteAllText(Path.Combine(user,"scratch","tmp"),"tmp");File.WriteAllText(Path.Combine(user,"my-file.txt"),"unknown");
            File.WriteAllText(Path.Combine(user,"library.json"),JsonSerializer.Serialize(new{backups=new[]{new{id="one",path=keep}},installedMods=new[]{new{folder=mod}}}));
            if(Remove(user,false)!=0||Directory.Exists(Path.Combine(user,"translation-models"))||Directory.Exists(Path.Combine(user,"Cache"))||Directory.Exists(Path.Combine(user,"scratch"))||File.Exists(Path.Combine(user,"library.json"))||!File.Exists(Path.Combine(user,"backup-index.json"))||!File.Exists(Path.Combine(keep,"save.dat"))||!File.Exists(Path.Combine(mod,"mod.jar")))return false;
            if(Remove(user,true)!=0||Directory.Exists(Path.Combine(user,"backups"))||File.Exists(Path.Combine(user,"backup-index.json"))||!File.Exists(Path.Combine(user,"my-file.txt"))||!File.Exists(Path.Combine(mod,"mod.jar")))return false;
            Directory.CreateDirectory(Path.Combine(user,"scratch"));File.WriteAllText(Path.Combine(user,"library.json"),JsonSerializer.Serialize(new{downloads=new[]{new{path=Path.Combine(user,"scratch","chosen.zip")}}}));File.WriteAllText(Path.Combine(user,"scratch","chosen.zip"),"chosen");
            if(Remove(user,false)!=14||!File.Exists(Path.Combine(user,"scratch","chosen.zip"))||!File.Exists(Path.Combine(user,"library.json")))return false;
            File.WriteAllText(Path.Combine(user,"library.json"),"{broken");
            return Remove(user,false)==13&&File.Exists(Path.Combine(user,"scratch","chosen.zip"));
        }finally{Directory.Delete(root,true);}
    }
}
