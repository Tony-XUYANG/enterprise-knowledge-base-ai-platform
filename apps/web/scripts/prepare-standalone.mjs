import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const workspaceRoot = fileURLToPath(new URL('../', import.meta.url));
const standaloneRoot = fileURLToPath(
  new URL('../.next/standalone/apps/web/', import.meta.url),
);

function replaceDirectory(source, target) {
  if (!existsSync(source)) return;
  mkdirSync(target, { recursive: true });
  try {
    rmSync(target, { recursive: true, force: true });
    mkdirSync(target, { recursive: true });
  } catch (error) {
    if (!['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(error?.code)) throw error;
    // A running local standalone server can hold this directory open on Windows.
    // Existing stale chunks are harmless because Next references files by build ID.
  }
  cpSync(source, target, { recursive: true, force: true });
}

replaceDirectory(
  `${workspaceRoot}.next/static`,
  `${standaloneRoot}.next/static`,
);
replaceDirectory(`${workspaceRoot}public`, `${standaloneRoot}public`);
