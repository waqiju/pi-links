# pi-links

Pick and open links from your Pi conversations.

在 Pi 输入 `/links`，选择回复中的网页、报告或源码链接，然后在浏览器、默认应用或编辑器中打开。特别适合 **WSL + Windows Terminal**：相对路径由扩展解析，再交给 Windows，不依赖终端能否识别 Markdown 链接。

## Install

```sh
pi install npm:pi-links
```

Run `/reload` in an existing Pi session. Requires Node.js 22+ and Pi with the `@earendil-works/pi-coding-agent` extension API. Alternatively, install from Git with `pi install git:github.com/waqiju/pi-links`. If migrating from Git to npm, remove the old source first to avoid loading the extension twice.

## Usage

| Command | Result |
| --- | --- |
| `/links` | Links from assistant replies on the current session branch, newest replies first |
| `/links report` | Filter titles and destinations by a case-insensitive substring |
| `/links --last` | Links from the latest assistant message containing visible text |
| `/links --last html` | Filter that latest message |
| `/links --paths` | Also infer existing file and directory paths from inline code |
| `/links --last --paths src` | Infer paths in the latest message and filter by `src` |

Flags precede the filter; `--last` and `--paths` can appear in either order. Use `--` to end flag parsing, for example `/links -- --paths` searches for the literal text `--paths`.

Select with arrow keys and Enter; Escape cancels without opening anything. Items show both the Markdown title and destination. Duplicate resolved destinations keep their newest title. Explicit Markdown links and inline `file://` URLs to missing files stay visible and report an error when selected.

By default, only inline and reference-style Markdown links, images, web autolinks, bare HTTP(S) URLs, and explicit HTTP(S) / `file://` URLs in inline code are included. Inline code such as `/links`, `/`, or `src/main.py:42` is not treated as a link automatically.

Use `--paths` to additionally infer paths from inline code. Inferred files and directories must exist. Generic directory notation such as `/`, `./`, `../`, `~/`, and drive roots is excluded from inference; explicit links such as `[root](/)` still work. Path inference remains a heuristic, so enable it when you want file mentions as well as links.

Examples:

```markdown
[Report](reports/result.html)
[中文报告](<reports/中文 report.html>)
[Source](src/main.py:42:3)
[Source anchor](src/main.py#L42-L50)
[Web](https://example.com/docs)
`https://example.com/docs`
`file:///home/adam/report.html`
```

With `--paths`, existing inline paths such as `src/main.py:42` are also included.

Relative paths resolve against the Pi working directory. Percent-encoded file paths are decoded; use `%23`, `%3F`, and `%25` for literal `#`, `?`, and `%` in Markdown destinations. File suffixes such as `report.html#chart` and `report.html?view=wide` are preserved. Line ranges open at their first line.

Only assistant text on the active branch is scanned, including history before compaction. User messages, tool output, thinking blocks, fenced code and raw HTML are excluded. The extension does not modify messages or intercept Ctrl+click, and does not send conversation contents to a service.

## Opening behavior

| Environment / target | Launcher |
| --- | --- |
| WSL web URL | Windows PowerShell → default browser |
| WSL file | `wslpath -w` → Windows PowerShell → default application |
| macOS | `open` |
| Linux desktop | `xdg-open` |
| Native Windows | `powershell.exe` → default application |
| File with a line number | `code --goto path:line:column` |

WSL needs Windows interop enabled and `powershell.exe` / `wslpath` available in PATH. It does **not** need `wslview`. `/mnt/d/...` and Linux filesystem paths such as `/home/...` are converted by `wslpath`; Windows must be able to access the resulting drive or WSL share. Drive paths such as `D:\project\report.html` and `file:///D:/project/report.html` are also accepted under WSL (standard `/mnt/<drive>` mounts).

For line-number links, install VS Code's WSL launcher so `code` is in PATH. Alternatively set `PI_LINKS_EDITOR` to a **single executable path** that accepts VS Code's `--goto` argument, such as `codium`. It is not a shell command and does not accept embedded options. Without a working editor, line-number links show an actionable error; ordinary reports still open normally.

Only HTTP(S) and local files are supported; arbitrary URI schemes and remote-host `file://` links are ignored. Local `file://localhost/...` works. Protocol-only mentions such as `file://` or `file://localhost` are ignored rather than implicitly converted to the root directory; root file URIs in inline code are also excluded as generic protocol examples. Use an explicit Markdown link such as `[root](file:///)` to intentionally include a root directory. Inline file URIs pointing to concrete files or subdirectories remain supported. Directory/file associations, HTML local-resource restrictions and browser rendering are controlled by the OS/browser. This extension does not start an HTTP server. Non-UI modes do not launch applications. RPC clients may expose the built-in selection dialog, but files always open on the Pi host.

## Development

```sh
npm ci
npm run check
npm test
pi -e ./src/index.ts
```

Tests cover Markdown extraction, path normalization, WSL conversion, command quoting, opener routing, failure handling and the extension command. Launchers are mocked in automated tests; actual GUI behavior requires a desktop smoke test. Ask Pi to link to `examples/中文 report.html`, then select it with `/links` to test a filename with spaces and Chinese characters.

- `src/links.ts`: extraction, normalization, deduplication
- `src/open.ts`: platform launchers; argv-based execution and quoted, encoded PowerShell literals
- `src/index.ts`: branch traversal, filtering and Pi selection UI

## Publishing

Releases use GitHub Actions and npm Trusted Publishing (OIDC), without an npm token or per-release phone verification. See [the release guide](docs/releasing.md) for the one-time npm setup and release commands.

MIT licensed.
