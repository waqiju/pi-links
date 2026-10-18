import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { collectLinks, filterInferredPaths, plainLabel } from "./links.js";
import { isWSL, openTarget } from "./open.js";

export default function linksExtension(pi: ExtensionAPI) {
  pi.registerCommand("links", {
    description: "Pick and open conversation links: /links [filter], /links --last [filter]",
    handler: async (args, ctx) => {
      if (!ctx.hasUI) return;
      const last = /^--last(?:\s|$)/.test(args.trim());
      const filter = (last ? args.trim().replace(/^--last\s*/, "") : args.trim()).toLowerCase();
      const texts: string[] = [];
      for (const entry of [...ctx.sessionManager.getBranch()].reverse()) {
        if (entry.type !== "message" || entry.message.role !== "assistant") continue;
        const text = entry.message.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
        if (!text.trim()) continue;
        texts.push(text);
        if (last) break;
      }
      const candidates = collectLinks(texts, ctx.cwd, process.platform, isWSL())
        .filter((link) => `${link.label} ${link.href}`.toLowerCase().includes(filter));
      const links = await filterInferredPaths(candidates);
      if (!links.length) {
        ctx.ui.notify("No matching links in assistant replies on this branch.", "info");
        return;
      }
      const labels = links.map((link, index) => `${index + 1}. ${plainLabel(link.label)} — ${plainLabel(link.href)}`);
      const selected = await ctx.ui.select(`Links (${links.length}, newest replies first)`, labels);
      if (selected === undefined) return;
      const link = links[labels.indexOf(selected)];
      if (!link) return;
      try {
        await openTarget(link.target);
        ctx.ui.notify(`Opened: ${plainLabel(link.label)}`, "info");
      } catch (error) {
        ctx.ui.notify(`Could not open ${plainLabel(link.href)}: ${plainLabel(error instanceof Error ? error.message : String(error))}`, "error");
      }
    },
  });
}
