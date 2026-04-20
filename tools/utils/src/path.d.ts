export let __dirname: string;
export let __filename: string;

export function getProjectRootPath(callerUrl?: string): string;
export function getWorkspaceRootPath(): string;
export function getProjectRelativePathInWorkspace(callerUrl?: string): string;
export function getWorkspaceBinaryPath(binaryName: string): string;
export function getProjectBinaryPath(binaryName: string, callerUrl?: string): string;
export function getProjectFilePath(path: string | string[], callerUrl?: string): string;
export function getWorkspaceFilePath(path: string | string[]): string;
