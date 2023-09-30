using Microsoft.AspNetCore.Components;

namespace umount;

public interface ICommandExecutor
{
    public IEnumerable<MarkupString> Execute(string command);
}
