import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const workspaceRoot = fileURLToPath(new URL('../', import.meta.url));
const standaloneRoot = fileURLToPath(
  new URL('../.next/standalone/apps/web/', import.meta.url),
);

function replaceDirectory(source, target) {
  if (!existsSync(source)) return;
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  cpSync(source, target, { recursive: true });
}

replaceDirectory(
  `${workspaceRoot}.next/static`,
  `${standaloneRoot}.next/static`,
);
replaceDirectory(`${workspaceRoot}public`, `${standaloneRoot}public`);
