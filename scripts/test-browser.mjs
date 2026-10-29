import { access, readdir, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const list = args.includes('--list');
const all = args.includes('--all');
const groups = args.filter(arg => arg !== '--list' && arg !== '--all');
const core = !all && !groups.length;
const available = (await readdir(new URL('../tests/', import.meta.url)))
  .filter(file => file.endsWith('.browser.mjs')).sort();
for (const group of groups) {
  if (!available.some(file => file === group || file.startsWith(group + '.') || file.startsWith(group + '-')))
    throw new Error(`没有匹配的浏览器测试：${group}`);
}
let selected = available.filter(file => !groups.length || groups.some(group =>
  file === group || file.startsWith(group + '.') || file.startsWith(group + '-')));
// Core cases live beside their feature tests; the title is the only selection marker.
if (core) {
  const sources = await Promise.all(selected.map(file => readFile(new URL(`../tests/${file}`, import.meta.url), 'utf8')));
  selected = selected.filter((_, i) => /test\(\s*['"]\[core\]/.test(sources[i]));
  if (!selected.length) throw new Error('没有标记为 [core] 的核心链路测试。');
}
const files = selected.map(file => `tests/${file}`);
if (list) {
  console.log(core ? '核心链路：仅运行标题含 [core] 的用例' : '专题检查：运行所选文件中的用例');
  console.log(files.join('\n'));
} else {
  try { await access(new URL('../dist/index.html', import.meta.url)); }
  catch { throw new Error('请先运行 npm run build，或使用 npm run test:browser。'); }
  const child = spawn(process.execPath, ['--test', '--test-concurrency=2', ...(core ? ['--test-name-pattern=^\\[core\\]'] : []), ...files], {
    cwd: root, stdio: 'inherit',
  });
  child.on('error', error => { console.error(error); process.exitCode = 1; });
  child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
}
