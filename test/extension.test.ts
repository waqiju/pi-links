import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import extension from "../src/index.js";

function harness(branch: unknown[], hasUI = true, cwd = "/project") {
  let handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
  const notices: string[] = [];
  const menus: string[][] = [];
  extension({ registerCommand: (name: string, command: { handler: typeof handler }) => {
    assert.equal(name, "links"); handler = command.handler;
  } } as unknown as ExtensionAPI);
  const ctx = {
    hasUI, cwd,
    sessionManager: { getBranch: () => branch },
    ui: {
      notify: (text: string) => notices.push(text),
      select: async (_title: string, items: string[]) => { menus.push(items); return undefined; },
    },
  } as unknown as ExtensionCommandContext;
  return { run: (args = "") => handler(args, ctx), menus, notices };
}
const message = (role: string, text: string) => ({ type: "message", message: { role, content: [{ type: "text", text }] } });

test("command scans assistant text on supplied branch, newest first, and cancellation is inert", async () => {
  const h = harness([
    message("assistant", "[old](old.txt)"), message("user", "[ignore](user.txt)"),
    message("toolResult", "[ignore](tool.txt)"),
    message("assistant", "[new](new.txt)"),
    { type: "message", message: { role: "assistant", content: [{ type: "thinking", thinking: "[ignore](secret.txt)" }] } },
  ]);
  await h.run();
  assert.equal(h.menus[0].length, 2);
  assert.match(h.menus[0][0], /new/);
  assert.match(h.menus[0][1], /old/);
  assert.equal(h.notices.length, 0);
});

test("screenshot regression: slash commands do not appear in the picker", async () => {
  const h = harness([message("assistant", [
    '[waqiju/pi-links](https://github.com/waqiju/pi-links)',
    '[pi-links](/mnt/d/1_Workspace/pi-links)',
    '`/` `/links` `/links report` `/links --last` `/reload`',
    '[中文测试报告](</mnt/d/1_Workspace/pi-links/examples/中文 report.html>)',
  ].join("\n"))]);
  await h.run();
  assert.equal(h.menus[0].length, 3);
  assert.match(h.menus[0][0], /waqiju\/pi-links/);
  assert.match(h.menus[0][2], /中文测试报告/);
});

test("--paths opts in to existing files and combines with --last and filtering in either order", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "pi-links-command-"));
  try {
    await writeFile(path.join(cwd, "source.ts"), "source");
    const branch = [
      message("assistant", "[old source](old-source.ts)"),
      message("assistant", '`./source.ts:12` `./missing.ts` `/` `./` `../` `~/` `https://example.org` `file:///missing.txt`'),
    ];
    const h = harness(branch, true, cwd);
    await h.run("--last");
    assert.equal(h.menus[0].length, 2);
    assert.ok(h.menus[0].every(label => !label.includes("source.ts")));
    for (const args of ["--paths --last SOURCE", "--last --paths SOURCE"]) {
      await h.run(args);
      assert.equal(h.menus.at(-1)!.length, 1);
      assert.match(h.menus.at(-1)![0], /source.ts:12/);
    }
    await h.run("--last --paths");
    assert.equal(h.menus.at(-1)!.length, 3);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("-- ends flag parsing and flags inside the filter remain literal", async () => {
  const h = harness([message("assistant", '[--paths](one.txt) [guide --last](two.txt)')]);
  await h.run("-- --paths");
  assert.equal(h.menus[0].length, 1);
  assert.match(h.menus[0][0], /one.txt/);
  await h.run("guide --last");
  assert.equal(h.menus[1].length, 1);
  assert.match(h.menus[1][0], /two.txt/);
});

test("--last and title filtering, empty results, non-UI guard", async () => {
  const branch = [message("assistant", "[old](old.txt)"), message("assistant", "[Report](report.html) [Other](other.txt)")];
  const h = harness(branch);
  await h.run("--last REPORT");
  assert.equal(h.menus[0].length, 1);
  assert.match(h.menus[0][0], /Report/);
  await h.run("--last old");
  assert.match(h.notices[0], /No matching links/);
  const noUI = harness(branch, false);
  await noUI.run();
  assert.equal(noUI.menus.length, 0);
});
