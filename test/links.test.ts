import assert from "node:assert/strict";
import test from "node:test";
import { collectLinks, extractLinks, plainLabel, resolveTarget } from "../src/links.js";
import { openTarget, powershellArgs } from "../src/open.js";

test("Markdown titles, references, nested parentheses, Unicode, autolinks and inline paths", () => {
  const links = extractLinks('[报告](<reports/中文 report.html>) [ref][r] [nested](a(b).pdf)\n\n[r]: https://example.com/docs\n\n<https://example.org> `src/main.ts:12:3`\n\n```md\n[ignore](secret.txt)\n```');
  assert.deepEqual(links.map(l => l.href), ["reports/中文 report.html", "https://example.com/docs", "a(b).pdf", "https://example.org", "src/main.ts:12:3"]);
  assert.equal(links[0].label, "报告");
});

test("inline-code link labels do not create a second destination", () => {
  assert.deepEqual(extractLinks('[`src/app.ts`](src/app.ts:12)'), [{ label: '`src/app.ts`', href: 'src/app.ts:12' }]);
});

test("relative, encoded, Windows and file URI paths in WSL", () => {
  for (const href of ["reports/%E4%B8%AD%E6%96%87%20report.html", "file:///D:/project/reports/%E4%B8%AD%E6%96%87%20report.html", "D:\\project\\reports\\中文 report.html"]) {
    assert.deepEqual(resolveTarget(href, "/mnt/d/project", "linux", true), { kind: "file", path: "/mnt/d/project/reports/中文 report.html", suffix: "", line: undefined, column: undefined });
  }
  assert.equal(resolveTarget("file:///home/adam/report.html", "/tmp", "linux", true)?.kind, "file");
});

test("line and column, GitHub line anchors, fragments and URL ports", () => {
  assert.deepEqual(resolveTarget("src/app.py:12:3", "/project"), { kind: "file", path: "/project/src/app.py", suffix: "", line: 12, column: 3 });
  assert.deepEqual(resolveTarget("src/app.py#L12-L15", "/project"), { kind: "file", path: "/project/src/app.py", suffix: "", line: 12, column: undefined });
  assert.deepEqual(resolveTarget("report.html?q=one#chart", "/project"), { kind: "file", path: "/project/report.html", suffix: "?q=one#chart", line: undefined, column: undefined });
  assert.deepEqual(resolveTarget("http://localhost:8765/#L12", "/project"), { kind: "url", url: "http://localhost:8765/#L12" });
});

test("reject unsafe schemes, control characters, malformed encodings and anchor-only links", () => {
  for (const href of ["javascript:alert(1)", "data:text/html,hi", "vscode:foo", "#heading", "x%00.txt", "x\n.txt", "bad%xx.txt", "file://server/share/a.txt", "a.ts:0"]) {
    assert.equal(resolveTarget(href, "/project"), undefined, href);
  }
  assert.equal(plainLabel("hey\x1b[31m\nthere"), "hey [31m there");
});

test("deduplicate normalized targets and keep newest title", () => {
  const result = collectLinks(["[new](./a.txt) [line](a.txt:2)", "[old](a.txt) [web](https://example.org)"], "/project");
  assert.deepEqual(result.map(l => l.label), ["new", "line", "web"]);
});

test("native Windows resolution", () => {
  assert.deepEqual(resolveTarget("file:///C:/project/a.txt", "C:\\project", "win32"), { kind: "file", path: "C:\\project\\a.txt", suffix: "", line: undefined, column: undefined });
});

test("WSL converts Linux paths before invoking PowerShell; literals survive quoting", async () => {
  const calls: [string, string[]][] = [];
  const winPath = "D:\\报告\\it's $(evil); & report.html";
  await openTarget({ kind: "file", path: "/mnt/d/报告/it's $(evil); & report.html", suffix: "" }, {
    platform: "linux", wsl: true, checkFile: async () => {},
    run: async (cmd, args) => { calls.push([cmd, args]); return winPath; },
  });
  assert.deepEqual(calls[0], ["wslpath", ["-w", "/mnt/d/报告/it's $(evil); & report.html"]]);
  assert.equal(calls[1][0], "powershell.exe");
  const script = Buffer.from(calls[1][1].at(-1)!, "base64").toString("utf16le");
  assert.equal(script, "$ErrorActionPreference = 'Stop'; Start-Process -FilePath 'D:\\报告\\it''s $(evil); & report.html'");
});

test("editor gets one literal argument and never converts WSL source path", async () => {
  const calls: unknown[] = [];
  await openTarget({ kind: "file", path: "/home/adam/a b.ts", suffix: "", line: 4, column: 2 }, {
    wsl: true, editor: "codium", checkFile: async () => {}, run: async (...args) => { calls.push(args); return ""; },
  });
  assert.deepEqual(calls, [["codium", ["--goto", "/home/adam/a b.ts:4:2"]]]);
});

test("missing files do not launch, failed launch propagates", async () => {
  await assert.rejects(openTarget({ kind: "file", path: "/missing", suffix: "" }, {
    checkFile: async () => { throw new Error("ENOENT"); }, run: async () => { assert.fail("must not launch"); },
  }), /ENOENT/);
  await assert.rejects(openTarget({ kind: "url", url: "https://example.org" }, {
    wsl: false, platform: "linux", run: async () => { throw new Error("launcher unavailable"); },
  }), /launcher unavailable/);
});

test("web and native desktop launchers", async () => {
  for (const [platform, command] of [["darwin", "open"], ["linux", "xdg-open"], ["win32", "powershell.exe"]] as const) {
    const calls: unknown[] = [];
    await openTarget({ kind: "url", url: "https://example.org/a?b=1&c=2" }, { platform, wsl: false, run: async (...args) => { calls.push(args); return ""; } });
    assert.deepEqual(calls, [[command, platform === "win32" ? powershellArgs("https://example.org/a?b=1&c=2") : ["https://example.org/a?b=1&c=2"]]]);
  }
});
