using System.Diagnostics;
using GK2Trainer;
internal sealed class Gk2Live : IDisposable
{
    private static readonly Dictionary<string,string> Labels=new(){{"money","Деньги (внутреннее значение)"},{"energy","Энергия"},{"stamina","Выносливость"},{"insanity","Безумие"},{"happiness","Счастье"},{"tech_red","Красные очки технологий"},{"tech_green","Зелёные очки технологий"},{"tech_blue","Синие очки технологий"}};
    private ProcessMemory? mem; private GameResLocator? locator;
    private readonly Dictionary<string,(float value,long until)> holds=new();
    private int pid;private long nextTick;private string warning="";
    internal static bool Valid(string key,double value)=>Labels.ContainsKey(key)&&double.IsFinite(value)&&value>=0&&value<=1000000&&(!key.StartsWith("tech_")||value==Math.Truncate(value));
    private static Exception Invalid()=>new("Не удалось подтвердить текущий игровой мир. Подключитесь заново после загрузки сохранения.");
    internal object Start(string root,bool exact)
    {
        Dispose();var found=new List<ProcessMemory>();
        try{
            foreach(var p in Process.GetProcessesByName("GraveyardKeeper2"))using(p){
                var candidate=new ProcessMemory();
                if(!candidate.OpenScoped(p.Id,root,exact)){candidate.Dispose();continue;}
                if(ProcessMemory.ProbeModule(p.Id,"mono-2.0-bdwgc.dll")!=ProcessMemory.ModuleProbe.Present){candidate.Dispose();continue;}
                found.Add(candidate);
            }
            if(found.Count!=1)throw new Exception("Запустите одну установленную копию Graveyard Keeper 2 и загрузите сохранение. Поддерживается Mono.");
            mem=found[0];pid=mem.TargetPid;mem.Budget(4L*1024*1024*1024,55000);locator=new GameResLocator(mem);
            if(!locator.RefreshCurrentSaveAnchor()||!locator.IsInGameSession()||!locator.IsAnchorStillValid())throw Invalid();
            warning="";return Snapshot();
        }catch{Dispose();throw;}finally{foreach(var c in found)if(c!=mem)c.Dispose();}
    }
    private bool Verify(GameResAtom a)=>mem!=null&&locator!=null&&locator.GetClassNameUncached(mem.ReadLong(a.Address))=="GameResAtom"&&locator.ReadMonoString(mem.ReadLong(a.Address+GameResLocator.ATOM_TYPE))==a.TypeName;
    private Dictionary<string,GameResAtom> Read(){
        if(mem==null||locator==null||!mem.Alive)throw Invalid();mem.Budget(8*1024*1024,3000);
        if(!locator.IsInGameSession()||!locator.IsAnchorStillValid()||mem.ReadLong(locator.CurrentPlayerData+GameResLocator.PLAYERDATA_GAMERES)!=locator.CurrentGameRes)throw Invalid();
        var rows=new Dictionary<string,GameResAtom>();
        foreach(var a in locator.BuildResGroupViaAnchor()){
            if(!Labels.ContainsKey(a.TypeName))continue;if(rows.ContainsKey(a.TypeName)||!Verify(a))throw Invalid();
            var bytes=mem.ReadBytes(a.Address+GameResLocator.ATOM_VALUE,4);if(bytes==null||bytes.Length!=4)throw Invalid();
            a.Value=BitConverter.ToSingle(bytes,0);if(!float.IsFinite(a.Value))throw Invalid();rows.Add(a.TypeName,a);
        }
        if(!rows.ContainsKey("money")||!rows.ContainsKey("energy")||!locator.IsInGameSession()||!locator.IsSameSaveSlot())throw Invalid();return rows;
    }
    private void Write(GameResAtom a,float value){
        if(mem==null||locator==null||!locator.IsInGameSession()||!locator.IsSameSaveSlot()||mem.ReadLong(locator.CurrentPlayerData+GameResLocator.PLAYERDATA_GAMERES)!=locator.CurrentGameRes||!Verify(a)||!mem.WriteFloat(a.Address+GameResLocator.ATOM_VALUE,value))throw Invalid();
    }
    internal object Snapshot(){
        if(mem==null)return new{connected=false,pid=0,warning,fields=Array.Empty<object>()};
        try{var rows=Read();return new{connected=true,pid,warning,fields=rows.Select(x=>new{key=x.Key,label=Labels[x.Key],value=x.Value.Value,held=holds.ContainsKey(x.Key),target=holds.TryGetValue(x.Key,out var h)?(float?)h.value:null}).ToArray()};}
        catch{warning="Игровой мир изменился или перестал читаться. Все фиксации отключены.";Dispose();return new{connected=false,pid=0,warning,fields=Array.Empty<object>()};}
    }
    internal object Change(string key,double value,bool hold){
        if(!Valid(key,value))throw new Exception("Недопустимое значение ресурса.");
        try{var rows=Read();if(!rows.TryGetValue(key,out var atom))throw new Exception("Ресурс не найден.");Write(atom,(float)value);
            if(hold)holds[key]=((float)value,Environment.TickCount64+300000);else holds.Remove(key);
            var result=Snapshot();if(mem==null)throw Invalid();return result;
        }catch{warning="Запись остановлена; проверьте игру.";Dispose();throw;}
    }
    internal object Release(string key){holds.Remove(key);return Snapshot();}
    internal void Tick(){
        if(holds.Count==0||Environment.TickCount64<nextTick)return;nextTick=Environment.TickCount64+1000;
        try{foreach(var k in holds.Where(x=>x.Value.until<=Environment.TickCount64).Select(x=>x.Key).ToArray())holds.Remove(k);
            if(holds.Count==0)return;var rows=Read();foreach(var (key,hold) in holds){if(!rows.TryGetValue(key,out var atom))throw Invalid();if(atom.Value!=hold.value)Write(atom,hold.value);}
        }catch{warning="Автофиксация остановлена: структура игры изменилась.";Dispose();}
    }
    public void Dispose(){holds.Clear();locator=null;mem?.Dispose();mem=null;pid=0;}
}
