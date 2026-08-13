#!/usr/bin/env bun
// Zero-dependency local server for the translation export tool.
// Serves static files from this folder and exposes GET /api/load?repo=<path>
// which runs export-new-translations.ts and returns the TSV as JSON.

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const FOLDER = import.meta.dir;
const PORT = Number(process.env.PORT ?? 8787);
const HOSTNAME = 'localhost';
const SCRIPT_PATH = path.join(FOLDER, 'export-new-translations.ts');
const TIMEOUT_MS = 60_000;

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const TSV_HEADER = 'key\ten\tch\tzh';
const SUMMARY_PATTERN = /Summary:\s*(\d+)\s*new,\s*(\d+)\s*edited\s*->\s*(\d+)\s*row/;

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

  let result;
  try {
    result = spawnSync(process.execPath, [SCRIPT_PATH, repoPath], {
      cwd: FOLDER,
      encoding: 'utf8',
      timeout: TIMEOUT_MS,
      maxBuffer: 20 * 1024 * 1024,
    });
  } catch (error) {
    return jsonResponse({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (result.error) {
    if (result.error.killed) {
      return jsonResponse({ ok: false, error: 'Timed out' });
    }
    return jsonResponse({
      ok: false,
      error: (result.error.message || String(result.error)).trim().slice(0, 500),
    });
  }

  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim().slice(0, 500);
    return jsonResponse({ ok: false, error: detail || `Exit code ${result.status}` });
  }

  // Parse stdout TSV: optional header line, then key\ten\tch\tzh rows.
  const lines = (result.stdout || '').split(/\r?\n/);
  if (lines[0] === TSV_HEADER) lines.shift();

  const rows: { key: string; en: string; ch: string; zh: string }[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const fields = line.split('\t');
    if (fields.length !== 4) continue; // malformed line, skip
    const [key, en, ch, zh] = fields;
    rows.push({ key, en: en ?? '', ch: ch ?? '', zh: zh ?? '' });
  }

  // Parse stderr summary; fall back to row count if the pattern is missing.
  const match = SUMMARY_PATTERN.exec(result.stderr || '');
  const summary = match
    ? { total: Number(match[3]), new: Number(match[1]), edited: Number(match[2]) }
    : { total: rows.length, new: 0, edited: 0 };

  return jsonResponse({ ok: true, rows, summary });
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