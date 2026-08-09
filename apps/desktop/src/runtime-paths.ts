import path from "node:path";

// The compiled desktop entry lives at apps/desktop/dist/apps/desktop/src/main.js.
// The bundled renderer stays at apps/web/dist in both local and packaged layouts.
export function resolveDesktopWebDistDir(compiledDesktopDir: string): string {
  return path.resolve(compiledDesktopDir, "../../../../../../apps/web/dist");
}

export interface DesktopLaunchCommand {
  args: string[];
  workingDir?: string;
}

export function resolveDesktopLaunchCommand(options: {
  appImage?: string;
  argv: string[];
  cwd: string;
  execPath: string;
  isPackaged: boolean;
}): DesktopLaunchCommand {
  if (options.appImage?.trim()) {
    return {
      args: [options.appImage.trim(), "--background"]
    };
  }

  if (options.isPackaged) {
    return {
      args: [options.execPath, "--background"]
    };
  }

  const entryArg = options.argv[1];

  if (!entryArg || entryArg.startsWith("-")) {
    return {
      args: [options.execPath, "--background"],
      workingDir: options.cwd
    };
  }

  const entryPath = path.isAbsolute(entryArg) ? entryArg : path.resolve(options.cwd, entryArg);
  const launchArgs = [
    "/usr/bin/env",
    "ELECTRON_DISABLE_SANDBOX=1",
    options.execPath
  ];

  if (options.argv.includes("--no-sandbox")) {
    launchArgs.push("--no-sandbox");
  }

  launchArgs.push(entryPath, "--background");

  return {
    args: launchArgs,
    workingDir: options.cwd
  };
}
