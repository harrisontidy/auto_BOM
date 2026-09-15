using System;
using System.Diagnostics;
using System.IO;
using System.Threading.Tasks;
using System.Windows.Forms;

internal static class Launcher
{
    [STAThread]
    private static int Main(string[] args)
    {
        bool check = args.Length == 1 && args[0] == "--check";
        string root = AppDomain.CurrentDomain.BaseDirectory;
        string logDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "auto_BOM", "logs");
        string log = Path.Combine(logDir, "launcher-" + DateTime.Now.ToString("yyyyMMdd-HHmmss-fff") + ".log");
        try
        {
            Directory.CreateDirectory(logDir);
            string script = Path.Combine(root, check ? "Start auto_BOM.ps1" : "Start KiCad.ps1");
            if (!File.Exists(script)) throw new FileNotFoundException("The KiCad startup script is missing.", script);
            var info = new ProcessStartInfo {
                FileName = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "WindowsPowerShell", "v1.0", "powershell.exe"),
                // The user authorized RemoteSigned. Set it for this child too, because
                // Explorer can carry a different inherited execution-policy setting.
                Arguments = "-NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -WindowStyle Hidden -File \"" + script + "\"" + (check ? " -NoBrowser" : ""),
                WorkingDirectory = root,
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            };
            using (var child = Process.Start(info))
            {
                Task<string> output = child.StandardOutput.ReadToEndAsync();
                Task<string> errors = child.StandardError.ReadToEndAsync();
                child.WaitForExit();
                File.WriteAllText(log, "Script: " + script + Environment.NewLine + "Exit code: " + child.ExitCode + Environment.NewLine + output.Result + errors.Result);
                if (child.ExitCode != 0 && !check)
                    MessageBox.Show("KiCad could not start. Details are saved in:\n" + log + "\n\n" + errors.Result, "KiCad - Auto BOM", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return child.ExitCode;
            }
        }
        catch (Exception error)
        {
            try { File.AppendAllText(log, error.ToString()); } catch { }
            if (!check) MessageBox.Show(error.Message + "\n\nStartup log: " + log, "KiCad - Auto BOM", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }
}
