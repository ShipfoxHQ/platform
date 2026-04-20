import {existsSync} from 'node:fs';
import {dirname, join, relative} from 'node:path';
import {fileURLToPath} from 'node:url';

export const __filename = fileURLToPath(import.meta.url);
export const __dirname = dirname(__filename);

function getProjectRootForCaller(callerUrl) {
  let currentDir = dirname(fileURLToPath(callerUrl));
  while (currentDir !== dirname(currentDir)) {
    if (existsSync(join(currentDir, 'package.json'))) {
      return currentDir;
    }
    currentDir = dirname(currentDir);
  }
  return null;
}

export function getProjectRootPath(callerUrl) {
  const callerDir = callerUrl ? getProjectRootForCaller(callerUrl) : process.cwd();
  return callerDir;
}

export function getWorkspaceRootPath() {
  let currentDir = __dirname;
  while (currentDir !== dirname(currentDir)) {
    if (existsSync(join(currentDir, 'pnpm-lock.yaml'))) {
      return currentDir;
    }
    currentDir = dirname(currentDir);
  }
  return null;
}

export function getProjectRelativePathInWorkspace(callerUrl) {
  const projectRoot = getProjectRootPath(callerUrl);
  const workspaceRoot = getWorkspaceRootPath();
  return relative(workspaceRoot, projectRoot);
}

export function getProjectBinaryPath(binaryName, callerUrl) {
  const projectRoot = getProjectRootPath(callerUrl);
  return join(projectRoot, 'node_modules', '.bin', binaryName);
}

export function getWorkspaceBinaryPath(binaryName) {
  const workspaceRoot = getWorkspaceRootPath();
  return join(workspaceRoot, 'node_modules', '.bin', binaryName);
}

export function getProjectFilePath(path, callerUrl) {
  const paths = Array.isArray(path) ? path : [path];
  const projectRoot = getProjectRootPath(callerUrl);
  return join(projectRoot, ...paths);
}

export function getWorkspaceFilePath(path) {
  const paths = Array.isArray(path) ? path : [path];
  const workspaceRoot = getWorkspaceRootPath();
  return join(workspaceRoot, ...paths);
}
