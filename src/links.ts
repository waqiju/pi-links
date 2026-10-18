import { marked } from "marked";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface Link { label: string; href: string; inferred?: boolean }
export type Target = { kind: "url"; url: string } | { kind: "file"; path: string; suffix: string; line?: number; column?: number };

// Only explicit Markdown links, autolinks, bare web URLs and inline-code paths.
// Fenced code and HTML are deliberately not interpreted as links. Path guessing is opt-in.
export function extractLinks(text: string, includePaths = false): Link[] {
  const links: Link[] = [];
  const labelTokens = new WeakSet<object>();
  marked.walkTokens(marked.lexer(text), (token) => {
    if (labelTokens.has(token)) return;
    if (token.type === "link" || token.type === "image") {
      links.push({ label: token.text, href: token.href });
      if (token.tokens) marked.walkTokens(token.tokens, child => { labelTokens.add(child); });
    } else if (token.type === "codespan") {
      if (/^(?:https?|file):\/\//i.test(token.text)) {
        links.push({ label: token.text, href: token.text });
      } else if (includePaths && isPathCandidate(token.text)) {
        links.push({ label: token.text, href: token.text, inferred: true });
      }
    }
  });
  return links;
}

function isPathCandidate(text: string): boolean {
  // Generic directory notation does not identify a useful inferred destination.
  const base = text.split(/[?#]/)[0].replace(/:\d+(?::\d+)?$/, "").replace(/^[A-Za-z]:/, "");
  if (!base.split(/[\\/]/).some(part => !["", ".", "..", "~"].includes(part))) return false;
  return /^(?:[A-Za-z]:[\\/]|\.{0,2}\/|~\/)|^[^\s]+\.[a-zA-Z0-9]{1,10}(?::\d+(?::\d+)?)?$/.test(text);
}

export function resolveTarget(href: string, cwd: string, platform = process.platform, wsl = false): Target | undefined {
  if (!href || /[\x00-\x1f\x7f]/.test(href) || href.startsWith("#")) return;
  if (/^https?:\/\//i.test(href)) {
    try { return { kind: "url", url: new URL(href).href }; } catch { return; }
  }
  let raw = href;
  let suffix = "";
  let line: number | undefined;
  let column: number | undefined;
  const location = raw.match(/(?::(\d+)(?::(\d+))?|#L(\d+)(?:C(\d+))?(?:-L?\d+)?)$/);
  if (location) {
    line = Number(location[1] ?? location[3]);
    column = location[2] || location[4] ? Number(location[2] ?? location[4]) : undefined;
    raw = raw.slice(0, location.index);
    if (!Number.isSafeInteger(line) || line < 1 || (column !== undefined && (!Number.isSafeInteger(column) || column < 1))) return;
  }
  const suffixIndex = raw.search(/[?#]/);
  if (suffixIndex >= 0) { suffix = raw.slice(suffixIndex); raw = raw.slice(0, suffixIndex); }
  try {
    if (/^file:\/\//i.test(raw)) {
      const url = new URL(raw);
      if (url.hostname && url.hostname !== "localhost") return; // UNC hosts are not guessed.
      raw = platform === "win32" ? fileURLToPath(url, { windows: true }) : fileURLToPath(url);
      if (wsl && /^\/[A-Za-z]:\//.test(raw)) raw = raw.slice(1);
    } else {
      if (/^[a-z][a-z\d+.-]*:/i.test(raw) && !/^[A-Za-z]:[\\/]/.test(raw)) return;
      raw = decodeURIComponent(raw);
    }
  } catch { return; }
  if (!raw || /[\x00-\x1f\x7f]/.test(raw)) return;
  if (wsl && /^[A-Za-z]:[\\/]/.test(raw)) raw = `/mnt/${raw[0].toLowerCase()}/${raw.slice(3).replaceAll("\\", "/")}`;
  if (platform !== "win32" && /^[A-Za-z]:[\\/]/.test(raw)) return;
  if (raw.startsWith("~/")) raw = path.join(homedir(), raw.slice(2));
  const paths = platform === "win32" ? path.win32 : path.posix;
  return { kind: "file", path: paths.resolve(cwd, raw), suffix, line, column };
}

export function targetKey(target: Target): string {
  return target.kind === "url" ? target.url : `${target.path}:${target.line ?? ""}:${target.column ?? ""}${target.suffix}`;
}

export function plainLabel(text: string): string {
  return text.replace(/[\x00-\x1f\x7f-\x9f]/g, " ").replace(/\s+/g, " ").trim();
}

export interface Candidate extends Link { target: Target }
export function collectLinks(textsNewestFirst: string[], cwd: string, platform = process.platform, wsl = false, includePaths = false): Candidate[] {
  const seen = new Map<string, Candidate>();
  const results: Candidate[] = [];
  for (const text of textsNewestFirst) {
    for (const link of extractLinks(text, includePaths)) {
      const target = resolveTarget(link.href, cwd, platform, wsl);
      if (!target) continue;
      const key = targetKey(target);
      const existing = seen.get(key);
      if (existing) {
        // An explicit reference remains visible even if a newer inferred path is missing.
        if (!link.inferred) existing.inferred = false;
        continue;
      }
      const candidate = { ...link, target };
      seen.set(key, candidate);
      results.push(candidate);
    }
  }
  return results;
}

// Inline code also contains slash commands, package names and example filenames.
// Only promote guessed local paths when the filesystem confirms they exist.
export async function filterInferredPaths(candidates: Candidate[]): Promise<Candidate[]> {
  const visible = await Promise.all(candidates.map(async (candidate) => {
    if (!candidate.inferred || candidate.target.kind !== "file") return true;
    try {
      await access(candidate.target.path);
      return true;
    } catch {
      return false;
    }
  }));
  return candidates.filter((_, index) => visible[index]);
}
