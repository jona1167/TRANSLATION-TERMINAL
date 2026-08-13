#!/usr/bin/env bun

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const LOCALES = ['en', 'ch', 'zh'] as const;
const KEY_PATTERN = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+$/;

type Locale = (typeof LOCALES)[number];
type Bundle = Map<string, unknown>;
type Bundles = Record<Locale, Bundle>;

interface OutputRow {
  key: string;
  status: 'new' | 'edited';
  values: Partial<Record<Locale, string>>;
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }

  const clipboard = args.includes('--clipboard');
  const target = args.find((argument) => !argument.startsWith('-')) ?? process.cwd();
  const frontendRoot = findFrontendRoot(path.resolve(target));
  const repoRoot = getRepoRoot(frontendRoot);
  const i18nRoot = path.join(frontendRoot, 'src', 'assets', 'i18n');

  const sourceKeys = runTranslationChecker(frontendRoot);
  const current = loadCurrentBundles(i18nRoot);
  const head = loadHeadBundles(repoRoot, i18nRoot);
  const candidates = new Set(sourceKeys);

  for (const locale of LOCALES) {
    for (const key of current[locale].keys()) candidates.add(key);
  }

  const rows: OutputRow[] = [];
  for (const key of candidates) {
    const status = statusOf(key, current, head);
    if (!status) continue;
    rows.push({
      key,
      status,
      values: Object.fromEntries(
        LOCALES.map((locale) => [locale, stringValue(current[locale].get(key))]),
      ),
    });
  }
  rows.sort((left, right) => left.key.localeCompare(right.key));

  if (!rows.length) {
    console.log('No new or edited translation keys found.');
    return;
  }

  const tsv = rowsToTsv(rows);
  if (clipboard) copyToClipboard(tsv);
  else process.stdout.write(tsv);

  const newCount = rows.filter((row) => row.status === 'new').length;
  console.error(
    `Summary: ${newCount} new, ${rows.length - newCount} edited -> ${rows.length} row(s). ` +
      'Blank cells need a translation in the online sheet.',
  );
}

function findFrontendRoot(target: string): string {
  const directChecker = path.join(target, 'checkMissingTranslations.ts');
  if (fs.existsSync(directChecker)) return target;

  const nested = path.join(target, 'apps', 'frontend');
  if (fs.existsSync(path.join(nested, 'checkMissingTranslations.ts'))) return nested;

  throw new Error(
    `Cannot find checkMissingTranslations.ts under ${target} or ${nested}. ` +
      'Pass either the repository root or apps/frontend directory.',
  );
}

function getRepoRoot(frontendRoot: string): string {
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: frontendRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`Cannot find the Git repository containing ${frontendRoot}.`);
  }
  return result.stdout.trim();
}

function runTranslationChecker(frontendRoot: string): Set<string> {
  const result = spawnSync(process.execPath, ['run', 'checkMissingTranslations.ts'], {
    cwd: frontendRoot,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout).trim();
    throw new Error(`Translation checker failed${detail ? `:\n${detail}` : '.'}`);
  }

  const lines = result.stdout.split(/\r?\n/);
  const header = lines.findIndex((line) => /^Missing complete translations \(\d+\):$/.test(line));
  if (header < 0) return new Set();
  return new Set(lines.slice(header + 1).map((line) => line.trim()).filter((line) => KEY_PATTERN.test(line)));
}

function loadCurrentBundles(i18nRoot: string): Bundles {
  return Object.fromEntries(
    LOCALES.map((locale) => [locale, loadBundle(path.join(i18nRoot, `${locale}.json`))]),
  ) as Bundles;
}

function loadHeadBundles(repoRoot: string, i18nRoot: string): Bundles {
  return Object.fromEntries(
    LOCALES.map((locale) => [locale, loadHeadBundle(repoRoot, i18nRoot, locale)]),
  ) as Bundles;
}

function loadBundle(filePath: string): Bundle {
  return flattenBundle(JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown);
}

function loadHeadBundle(repoRoot: string, i18nRoot: string, locale: Locale): Bundle {
  const filePath = path.join(i18nRoot, `${locale}.json`);
  const gitPath = path.relative(repoRoot, filePath).split(path.sep).join('/');
  const result = spawnSync('git', ['show', `HEAD:${gitPath}`], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0) return new Map();
  return flattenBundle(JSON.parse(result.stdout) as unknown);
}

function flattenBundle(
  value: unknown,
  prefix = '',
  result = new Map<string, unknown>(),
): Bundle {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    if (prefix) result.set(prefix, value);
    return result;
  }

  for (const [key, child] of Object.entries(value)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      flattenBundle(child, fullKey, result);
    } else {
      result.set(fullKey, child);
    }
  }
  return result;
}

function statusOf(key: string, current: Bundles, head: Bundles): OutputRow['status'] | undefined {
  const inAnyCurrent = LOCALES.some((locale) => current[locale].has(key));
  if (!inAnyCurrent) return 'new';

  const inHead = LOCALES.some((locale) => head[locale].has(key));
  if (!inHead) return 'new';

  const edited = LOCALES.some(
    (locale) => stringValue(current[locale].get(key)) !== stringValue(head[locale].get(key)),
  );
  return edited ? 'edited' : undefined;
}

function rowsToTsv(rows: OutputRow[]): string {
  return ['key\ten\tch\tzh', ...rows.map(toTsvRow)].join('\n') + '\n';
}

function toTsvRow(row: OutputRow): string {
  return [row.key, ...LOCALES.map((locale) => row.values[locale] ?? '')]
    .map((value) => value.replace(/[\t\r\n]+/g, ' ').trim())
    .join('\t');
}

function copyToClipboard(text: string): void {
  if (process.platform === 'darwin') {
    const result = spawnSync('pbcopy', [], { input: text, encoding: 'utf8' });
    if (result.status === 0) {
      console.error('Copied to clipboard. Paste into the online sheet with Cmd+V.');
      return;
    }
  }
  process.stdout.write(text);
  console.error('Clipboard unavailable; printed the table instead.');
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function printHelp(): void {
  console.log(`Export new or edited translations from your project checkout.

Usage:
  bun export-new-translations.ts /path/to/your-app
  bun export-new-translations.ts /path/to/your-app --clipboard

The target may be the repository root or its apps/frontend directory.`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
