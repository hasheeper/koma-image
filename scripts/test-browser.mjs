import { access, readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const list = args.includes('--list');
const groups = args.filter(arg => arg !== '--list');
const available = (await readdir(new URL('../tests/', import.meta.url)))
  .filter(file => file.endsWith('.browser.mjs')).sort();
for (const group of groups) {
  if (!available.some(file => file === group || file.startsWith(group + '.') || file.startsWith(group + '-')))
    throw new Error(`没有匹配的浏览器测试：${group}`);
}
const selected = available.filter(file => !groups.length || groups.some(group =>
  file === group || file.startsWith(group + '.') || file.startsWith(group + '-')));
const files = selected.map(file => `tests/${file}`);
if (!groups.length) files.push('tests/release.package.mjs');
if (list) {
  console.log(files.join('\n'));
} else {
  try { await access(new URL('../dist/index.html', import.meta.url)); }
  catch { throw new Error('请先运行 npm run build，或使用 npm run test:browser。'); }
  const child = spawn(process.execPath, ['--test', '--test-concurrency=2', ...files], {
    cwd: root, stdio: 'inherit',
  });
  child.on('error', error => { console.error(error); process.exitCode = 1; });
  child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
}
