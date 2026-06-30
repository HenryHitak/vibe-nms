using System;
using System.Diagnostics;
using System.IO;
using System.Security.Principal;

internal static class VibeNmsInstallerLauncher
{
    private static int Main(string[] args)
    {
        string exePath = Process.GetCurrentProcess().MainModule.FileName;
        string exeName = Path.GetFileNameWithoutExtension(exePath);
        bool uninstall = exeName.IndexOf("uninstall", StringComparison.OrdinalIgnoreCase) >= 0;
        string action = uninstall ? "uninstall" : "install";
        string baseDir = AppDomain.CurrentDomain.BaseDirectory;
        string scriptPath = Path.Combine(Path.Combine(baseDir, "installer"), action + ".ps1");

        if (!File.Exists(scriptPath))
        {
            Console.Error.WriteLine("Cannot find installer script:");
            Console.Error.WriteLine(scriptPath);
            Console.Error.WriteLine();
            Console.Error.WriteLine("Extract vibe-nms-windows-installer.zip first, then run this EXE from the extracted folder.");
            Pause();
            return 1;
        }

        if (!IsAdministrator())
        {
            return RelaunchAsAdministrator(exePath, args);
        }

        return RunPowerShell(scriptPath, baseDir);
    }

    private static bool IsAdministrator()
    {
        WindowsIdentity identity = WindowsIdentity.GetCurrent();
        WindowsPrincipal principal = new WindowsPrincipal(identity);
        return principal.IsInRole(WindowsBuiltInRole.Administrator);
    }

    private static int RelaunchAsAdministrator(string exePath, string[] args)
    {
        ProcessStartInfo info = new ProcessStartInfo();
        info.FileName = exePath;
        info.Arguments = JoinArguments(args);
        info.WorkingDirectory = AppDomain.CurrentDomain.BaseDirectory;
        info.UseShellExecute = true;
        info.Verb = "runas";

        try
        {
            Process.Start(info);
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("Administrator permission was not granted.");
            Console.Error.WriteLine(ex.Message);
            Pause();
            return 1;
        }
    }

    private static int RunPowerShell(string scriptPath, string workingDirectory)
    {
        string powerShellPath = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.System),
            @"WindowsPowerShell\v1.0\powershell.exe");

        if (!File.Exists(powerShellPath))
        {
            powerShellPath = "powershell.exe";
        }

        ProcessStartInfo info = new ProcessStartInfo();
        info.FileName = powerShellPath;
        info.Arguments = "-NoProfile -ExecutionPolicy Bypass -File " + Quote(scriptPath);
        info.WorkingDirectory = workingDirectory;
        info.UseShellExecute = false;

        Process process = Process.Start(info);
        process.WaitForExit();

        Console.WriteLine();
        Console.WriteLine(process.ExitCode == 0 ? "Done." : "Failed. Exit code: " + process.ExitCode);
        Pause();
        return process.ExitCode;
    }

    private static string JoinArguments(string[] args)
    {
        if (args == null || args.Length == 0)
        {
            return string.Empty;
        }

        string[] quoted = new string[args.Length];
        for (int i = 0; i < args.Length; i++)
        {
            quoted[i] = Quote(args[i]);
        }
        return string.Join(" ", quoted);
    }

    private static string Quote(string value)
    {
        return "\"" + value.Replace("\"", "\\\"") + "\"";
    }

    private static void Pause()
    {
        if (Environment.UserInteractive)
        {
            Console.WriteLine("Press Enter to close.");
            Console.ReadLine();
        }
    }
}
