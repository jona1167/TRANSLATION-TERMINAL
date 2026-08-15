#!/usr/bin/env bun
// Zero-dependency local server for the translation export tool.
// Serves the web app and exposes GET /api/load?repo=<path> which runs the
// export logic directly and returns the TSV as JSON.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { runExport } from './export-core.ts';

// When bundled with `bun build --compile`, import.meta.dir points into the
// virtual file system; static assets live next to the executable instead.
const isCompiled = import.meta.dir.startsWith('/$bunfs');
const FOLDER = isCompiled ? path.dirname(process.execPath) : import.meta.dir;
const PORT = Number(process.env.PORT ?? 8787);
const HOSTNAME = 'localhost';
const NO_OPEN = process.argv.includes('--no-open');

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function serveStatic(urlPath: string): Response {
  const decoded = decodeURIComponent(urlPath);
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const resolved = path.resolve(FOLDER, relative);

  // Path traversal guard: the resolved path must stay inside FOLDER.
  const rel = path.relative(FOLDER, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return new Response('Forbidden', { status: 403 });
  }

  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    return new Response('Not Found', { status: 404 });
  }

  const ext = path.extname(resolved).toLowerCase();
  const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
  return new Response(fs.readFileSync(resolved), {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
    },
  });
}

function handleLoad(repoPath: string): Response {
  if (!repoPath) {
    return jsonResponse({ ok: false, error: 'Missing repo path' });
  }

  try {
    const { rows, summary } = runExport(repoPath);
    return jsonResponse({ ok: true, rows, summary });
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error))
      .trim()
      .slice(0, 500);
    return jsonResponse({ ok: false, error: message });
  }
}

// Opens a native macOS Finder "choose folder" dialog via osascript and returns
// the picked absolute path. Async on purpose: the dialog can stay open for
// minutes and must not block the rest of the server.
function handlePickFolder(): Promise<Response> {
  if (process.platform !== 'darwin') {
    return Promise.resolve(
      jsonResponse({ ok: false, error: 'Folder picker is only available on macOS' }),
    );
  }
  return new Promise((resolve) => {
    const child = spawn(
      'osascript',
      ['-e', 'POSIX path of (choose folder with prompt "Choose the repository folder")'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('error', (err) => resolve(jsonResponse({ ok: false, error: err.message })));
    child.on('close', (code) => {
      if (code === 0) {
        const picked = stdout.trim();
        resolve(
          picked
            ? jsonResponse({ ok: true, path: picked })
            : jsonResponse({ ok: false, error: 'No folder selected' }),
        );
        return;
      }
      resolve(
        jsonResponse({
          ok: false,
          error: /-1743/.test(stderr)
            ? 'Finder picker not authorized — enable in System Settings > Privacy & Security > Automation'
            : 'Cancelled',
        }),
      );
    });
  });
}

const server = Bun.serve({
  hostname: HOSTNAME,
  port: PORT,
  fetch(request) {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/api/load') {
        return handleLoad(url.searchParams.get('repo') ?? '');
      }
      if (url.pathname === '/api/pick-folder') {
        return handlePickFolder();
      }
      return serveStatic(url.pathname);
    } catch (error) {
      return jsonResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
});

console.log(`Translation Terminal -> http://${HOSTNAME}:${server.port}`);

if (!NO_OPEN && !process.env.CI) {
  setTimeout(() => {
    const url = `http://${HOSTNAME}:${server.port}`;
    const commands: Record<string, [string, string[]]> = {
      darwin: ['open', [url]],
      linux: ['xdg-open', [url]],
      win32: ['cmd', ['/c', 'start', url]],
    };
    const [cmd, args] = commands[process.platform] ?? [];
    if (cmd) spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
  }, 400);
}
