import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { collectLinks, filterInferredPaths, plainLabel } from "./links.js";
import { isWSL, openTarget } from "./open.js";

export default function linksExtension(pi: ExtensionAPI) {
  pi.registerCommand("links", {
    description: "Pick and open conversation links: /links [--last] [--paths] [filter]",
    handler: async (args, ctx) => {
      if (!ctx.hasUI) return;
      let remaining = args.trim();
      let last = false;
      let includePaths = false;
      // Flags precede the filter and may appear in either order. -- ends flag parsing.
      while (remaining) {
        const match = remaining.match(/^(--last|--paths|--)(?:\s+|$)/);
        if (!match) break;
        remaining = remaining.slice(match[0].length);
        if (match[1] === "--") break;
        if (match[1] === "--last") last = true;
        if (match[1] === "--paths") includePaths = true;
      }
      const filter = remaining.toLowerCase();
      const texts: string[] = [];
      for (const entry of [...ctx.sessionManager.getBranch()].reverse()) {
        if (entry.type !== "message" || entry.message.role !== "assistant") continue;
        const text = entry.message.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
        if (!text.trim()) continue;
        texts.push(text);
        if (last) break;
      }
      const candidates = collectLinks(texts, ctx.cwd, process.platform, isWSL(), includePaths)
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
