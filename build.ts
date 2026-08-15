// Builds standalone executables for the web app and CLI.
// Usage: bun build.ts   (optionally: bun build.ts --host-only)
import { $ } from 'bun';

await $`rm -rf dist && mkdir -p dist`.quiet();

const onlyHost = process.argv.includes('--host-only');

const serverTargets: Record<string, string | undefined> = {
  'translation-terminal-darwin-arm64': undefined,
  'translation-terminal-darwin-x64': 'bun-darwin-x64',
  'translation-terminal-linux-x64': 'bun-linux-x64',
  'translation-terminal-windows-x64.exe': 'bun-windows-x64',
};
const cliTargets: Record<string, string | undefined> = {
  'translation-terminal-cli-darwin-arm64': undefined,
  'translation-terminal-cli-darwin-x64': 'bun-darwin-x64',
  'translation-terminal-cli-linux-x64': 'bun-linux-x64',
  'translation-terminal-cli-windows-x64.exe': 'bun-windows-x64',
};

async function compile(entry: string, name: string, target: string | undefined) {
  const args = ['build', '--compile', '--minify', entry, '--outfile', `dist/${name}`];
  if (target) args.push('--target', target);
  console.log(`-> ${name}`);
  try {
    await Bun.spawn({ cmd: ['bun', ...args], stdout: 'inherit', stderr: 'inherit' });
    return true;
  } catch {
    console.error(`   FAILED (cross-compile to ${target} unsupported on this host)`);
    return false;
  }
}

for (const [name, target] of Object.entries(serverTargets)) {
  if (onlyHost && target) continue;
  await compile('server.ts', name, target);
}
for (const [name, target] of Object.entries(cliTargets)) {
  if (onlyHost && target) continue;
  await compile('export-new-translations.ts', name, target);
}

await $`cp index.html styles.css app.js favicon.svg dist/`.quiet();
console.log('done. Assets copied to dist/ alongside the server binaries.');
