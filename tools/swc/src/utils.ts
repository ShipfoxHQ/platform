import {existsSync, type Stats} from 'node:fs';
import {readdir, rm, stat} from 'node:fs/promises';
import {join} from 'node:path';
import {isEqual} from 'date-fns';

async function listFilesWithExtension(path: string, extensions: string[]) {
  if (!existsSync(path)) return [];
  const allFiles = await readdir(path, {recursive: true});
  return allFiles.filter((f) => extensions.some((e) => f.endsWith(e))).map((f) => join(path, f));
}

interface OwnedFileStat {
  file: string;
  stat: Stats;
}

function getFileStats(files: string[]): Promise<OwnedFileStat[]> {
  return Promise.all(files.map(async (f) => ({file: f, stat: await stat(f)})));
}

export async function getOwnedFileStats(outputPath: string): Promise<OwnedFileStat[]> {
  const ownedFiles = await listFilesWithExtension(outputPath, ['.js', '.js.map']);
  return getFileStats(ownedFiles);
}

function rmFiles(files: string[]): Promise<unknown[]> {
  return Promise.all(files.map((f) => rm(f, {force: true})));
}

export async function cleanup(
  outputPath: string,
  previousFiles: OwnedFileStat[],
): Promise<OwnedFileStat[]> {
  const currentFiles = await getOwnedFileStats(outputPath);

  const filesToDelete = previousFiles.filter((previous) => {
    const current = currentFiles.find((f) => f.file === previous.file);
    return !current || isEqual(current.stat.mtime, previous.stat.mtime);
  });
  await rmFiles(filesToDelete.map((f) => f.file));
  return currentFiles;
}
