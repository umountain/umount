using Microsoft.AspNetCore.Components;

namespace umount;

public class CommandExecutor : ICommandExecutor
{
    public IEnumerable<MarkupString> Execute(string command)
    {
        return new MarkupString[] { new ("hello!")};
    }
}
