import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';

for (const target of ['chrome', 'firefox']) {
  const directory = new URL(`../dist/${target}/`, import.meta.url);
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  await cp(new URL('../extension/', import.meta.url), directory, { recursive: true });
  const manifest = JSON.parse(await readFile(new URL('manifest.json', directory), 'utf8'));
  if (target === 'firefox') {
    manifest.permissions = manifest.permissions.filter(value => value !== 'sidePanel');
    manifest.background = { scripts: ['background.js'] };
    manifest.sidebar_action = { default_panel: 'panel.html', default_title: 'QuizLens' };
    manifest.browser_specific_settings = { gecko: {
      id: 'quizlens@kevkoa2106.github.io', strict_min_version: '142.0',
      data_collection_permissions: { required: ['websiteContent', 'authenticationInfo'] }
    } };
    delete manifest.side_panel;
    delete manifest.minimum_chrome_version;
  }
  await writeFile(new URL('manifest.json', directory), JSON.stringify(manifest, null, 2) + '\n');
}
