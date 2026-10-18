import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import extension from "../src/index.js";

function harness(branch: unknown[], hasUI = true) {
  let handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
  const notices: string[] = [];
  const menus: string[][] = [];
  extension({ registerCommand: (name: string, command: { handler: typeof handler }) => {
    assert.equal(name, "links"); handler = command.handler;
  } } as unknown as ExtensionAPI);
  const ctx = {
    hasUI, cwd: "/project",
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
