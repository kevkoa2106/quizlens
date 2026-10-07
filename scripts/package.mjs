import './build.mjs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { zipSync } from 'fflate';

async function collect(directory, prefix = '') {
  const files = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const name = prefix + entry.name;
    const location = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
    if (entry.isDirectory()) Object.assign(files, await collect(location, name + '/'));
    else if (entry.isFile()) files[name] = await readFile(location);
  }
  return files;
}

for (const target of ['chrome', 'firefox']) {
  const files = await collect(new URL(`../dist/${target}/`, import.meta.url));
  const output = new URL(`../dist/quizlens-${target}.zip`, import.meta.url);
  await writeFile(output, zipSync(files));
  console.log(`Created dist/quizlens-${target}.zip`);
}
