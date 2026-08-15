#!/usr/bin/env bun

import { runExport, copyToClipboard } from './export-core.ts';

function main(): void {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }

  const clipboard = args.includes('--clipboard');
  const target = args.find((argument) => !argument.startsWith('-')) ?? process.cwd();

  const { tsv, summary } = runExport(target);

  if (!summary.total) {
    console.log('No new or edited translation keys found.');
    return;
  }

  if (clipboard) {
    if (copyToClipboard(tsv)) {
      console.error('Copied to clipboard. Paste into the online sheet with Cmd+V.');
      return;
    }
    process.stdout.write(tsv);
    console.error('Clipboard unavailable; printed the table instead.');
    return;
  }

  process.stdout.write(tsv);
  console.error(
    `Summary: ${summary.new} new, ${summary.edited} edited -> ${summary.total} row(s). ` +
      'Blank cells need a translation in the online sheet.',
  );
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
