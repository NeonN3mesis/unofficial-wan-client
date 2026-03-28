import path from "node:path";

// The compiled desktop entry lives at apps/desktop/dist/apps/desktop/src/main.js.
// The bundled renderer stays at apps/web/dist in both local and packaged layouts.
export function resolveDesktopWebDistDir(compiledDesktopDir: string): string {
  return path.resolve(compiledDesktopDir, "../../../../../../apps/web/dist");
}
