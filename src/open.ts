import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { release } from "node:os";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import type { Target } from "./links.js";

const exec = promisify(execFile);
export const isWSL = () => process.platform === "linux" && /microsoft/i.test(release());
export type Runner = (command: string, args: string[]) => Promise<string>;
const run: Runner = async (command, args) => {
  const result = await exec(command, args, { timeout: 15_000, maxBuffer: 1024 * 1024, windowsHide: true });
  return result.stdout.trim();
};

export function powershellArgs(target: string): string[] {
  // Encode the entire script as UTF-16LE; the target is a single-quoted literal.
  // No cmd.exe, shell interpolation, or untrusted executable/script fragments.
  const script = `$ErrorActionPreference = 'Stop'; Start-Process -FilePath '${target.replaceAll("'", "''")}'`;
  return ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")];
}

export interface OpenOptions {
  platform?: NodeJS.Platform;
  wsl?: boolean;
  editor?: string;
  run?: Runner;
  checkFile?: (path: string) => Promise<unknown>;
}

export async function openTarget(target: Target, options: OpenOptions = {}): Promise<void> {
  const platform = options.platform ?? process.platform;
  const wsl = options.wsl ?? isWSL();
  const execute = options.run ?? run;
  let destination: string;
  if (target.kind === "file") {
    await (options.checkFile ?? access)(target.path);
    if (target.line !== undefined) {
      const editor = options.editor ?? process.env.PI_LINKS_EDITOR ?? "code";
      try {
        await execute(editor, ["--goto", `${target.path}:${target.line}:${target.column ?? 1}`]);
      } catch (error) {
        throw new Error(`Could not open editor ${editor}. Install the VS Code WSL launcher, or set PI_LINKS_EDITOR to a VS Code-compatible executable. ${error instanceof Error ? error.message : error}`);
      }
      return;
    }
    destination = target.path;
    if (wsl) destination = await execute("wslpath", ["-w", target.path]);
    if (target.suffix) {
      if (wsl || platform === "win32") {
        const normalized = destination.replaceAll("\\", "/");
        destination = normalized.startsWith("//")
          ? `file://${normalized.slice(2).split("/").map(encodeURIComponent).join("/")}`
          : `file:///${normalized.split("/").map((part, i) => i === 0 ? part : encodeURIComponent(part)).join("/")}`;
      } else destination = pathToFileURL(destination).href;
      destination += target.suffix;
    }
  } else destination = target.url;
  if (wsl || platform === "win32") {
    await execute("powershell.exe", powershellArgs(destination));
  } else if (platform === "darwin") {
    await execute("open", [destination]);
  } else {
    await execute("xdg-open", [destination]);
  }
}
