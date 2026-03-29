import fs from "node:fs/promises";
import path from "node:path";

function getAutostartDir(): string {
  const configHome = process.env.XDG_CONFIG_HOME ?? path.join(process.env.HOME ?? "", ".config");
  return path.join(configHome, "autostart");
}

export function quoteDesktopExecArg(value: string): string {
  return `"${value.replace(/(["\\])/g, "\\$1")}"`;
}

export async function syncLinuxAutostart(
  enabled: boolean,
  options: {
    appName: string;
    execPath: string;
  }
): Promise<void> {
  if (process.platform !== "linux") {
    return;
  }

  const autostartDir = getAutostartDir();
  const entryPath = path.join(autostartDir, "unofficial-wan-client.desktop");
  const legacyEntryPath = path.join(autostartDir, "wan-signal.desktop");

  try {
    await fs.unlink(legacyEntryPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  if (!enabled) {
    try {
      await fs.unlink(entryPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }

    return;
  }

  await fs.mkdir(autostartDir, { recursive: true });
  await fs.writeFile(
    entryPath,
    [
      "[Desktop Entry]",
      "Type=Application",
      `Name=${options.appName}`,
      `Exec=${quoteDesktopExecArg(options.execPath)} --background`,
      "Terminal=false",
      "X-GNOME-Autostart-enabled=true"
    ].join("\n"),
    { mode: 0o644 }
  );
}
