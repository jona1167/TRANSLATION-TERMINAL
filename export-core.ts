import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const LOCALES = ['en', 'ch', 'zh'] as const;

const KEY_PATTERN = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+$/;

type Locale = (typeof LOCALES)[number];
type Bundle = Map<string, unknown>;
type Bundles = Record<Locale, Bundle>;

export interface ExportRow {
  key: string;
  status: 'new' | 'edited';
  values: Partial<Record<Locale, string>>;
}

export interface ExportSummary {
  total: number;
  new: number;
  edited: number;
}

export interface ExportResult {
  rows: ExportRow[];
  tsv: string;
  summary: ExportSummary;
}

// When bundled with `bun build --compile`, import.meta.dir points into the
// virtual file system, so script spawning must go through `bun` on the PATH.
const isCompiled = import.meta.dir.startsWith('/$bunfs');
const RUNNER = isCompiled ? 'bun' : process.execPath;

export function runExport(target: string): ExportResult {
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

  const rows: ExportRow[] = [];
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

  const tsv = rowsToTsv(rows);
  const newCount = rows.filter((row) => row.status === 'new').length;
  return {
    rows,
    tsv,
    summary: { total: rows.length, new: newCount, edited: rows.length - newCount },
  };
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
  return fs.realpathSync(result.stdout.trim());
}

function runTranslationChecker(frontendRoot: string): Set<string> {
  const result = spawnSync(RUNNER, ['run', 'checkMissingTranslations.ts'], {
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
  const filePath = fs.realpathSync(path.join(i18nRoot, `${locale}.json`));
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

function statusOf(key: string, current: Bundles, head: Bundles): ExportRow['status'] | undefined {
  const inAnyCurrent = LOCALES.some((locale) => current[locale].has(key));
  if (!inAnyCurrent) return 'new';

  const inHead = LOCALES.some((locale) => head[locale].has(key));
  if (!inHead) return 'new';

  const edited = LOCALES.some(
    (locale) => stringValue(current[locale].get(key)) !== stringValue(head[locale].get(key)),
  );
  return edited ? 'edited' : undefined;
}

function rowsToTsv(rows: ExportRow[]): string {
  return ['key\ten\tch\tzh', ...rows.map(toTsvRow)].join('\n') + '\n';
}

function toTsvRow(row: ExportRow): string {
  return [row.key, ...LOCALES.map((locale) => row.values[locale] ?? '')]
    .map((value) => value.replace(/[\t\r\n]+/g, ' ').trim())
    .join('\t');
}

export function copyToClipboard(text: string): boolean {
  if (process.platform === 'darwin') {
    const result = spawnSync('pbcopy', [], { input: text, encoding: 'utf8' });
    if (result.status === 0) return true;
  }
  return false;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
