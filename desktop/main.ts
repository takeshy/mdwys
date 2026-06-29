// @ts-nocheck
const distDir = new URL("../dist/", import.meta.url);

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function contentType(pathname: string): string {
  const ext = pathname.match(/\.[^.\/]+$/)?.[0] ?? ".html";
  return contentTypes[ext] ?? "application/octet-stream";
}

async function serveFile(pathname: string): Promise<Response> {
  const cleanPath = decodeURIComponent(pathname).replace(/^\/+/, "");
  const filePath = cleanPath && !cleanPath.endsWith("/")
    ? new URL(cleanPath, distDir)
    : new URL("index.html", distDir);

  if (!filePath.href.startsWith(distDir.href)) {
    return new Response("Forbidden", { status: 403 });
  }

  try {
    const file = await Deno.readFile(filePath);
    return new Response(file, {
      headers: {
        "content-type": contentType(filePath.pathname),
        "cache-control": "no-cache",
      },
    });
  } catch {
    const index = await Deno.readFile(new URL("index.html", distDir));
    return new Response(index, {
      headers: { "content-type": contentTypes[".html"] },
    });
  }
}

const server = Deno.serve({ hostname: "127.0.0.1", port: 0 }, (req) => {
  const url = new URL(req.url);
  return serveFile(url.pathname);
});

const win = new Deno.BrowserWindow({
  title: "mdwys",
  width: 1200,
  height: 820,
});

win.setApplicationMenu?.([
  {
    submenu: {
      label: "mdwys",
      items: [
        { role: { role: "about" } },
        "separator",
        { role: { role: "quit" } },
      ],
    },
  },
  {
    submenu: {
      label: "File",
      items: [
        { item: { label: "New", id: "new", accelerator: "CmdOrCtrl+N", enabled: true } },
        { item: { label: "Open...", id: "open", accelerator: "CmdOrCtrl+O", enabled: true } },
        { item: { label: "Save", id: "save", accelerator: "CmdOrCtrl+S", enabled: true } },
        { item: { label: "Export Markdown...", id: "export", accelerator: "CmdOrCtrl+E", enabled: true } },
      ],
    },
  },
  {
    submenu: {
      label: "Edit",
      items: [
        { role: { role: "undo" } },
        { role: { role: "redo" } },
        "separator",
        { role: { role: "cut" } },
        { role: { role: "copy" } },
        { role: { role: "paste" } },
        { role: { role: "selectAll" } },
      ],
    },
  },
]);

win.addEventListener?.("menuclick", (event) => {
  const id = event.detail?.id;
  if (id) win.eval?.(`window.dispatchEvent(new CustomEvent("mdwys-menu", { detail: ${JSON.stringify(id)} }))`);
});

const addr = server.addr;
win.navigate?.(`http://127.0.0.1:${addr.port}/`);
