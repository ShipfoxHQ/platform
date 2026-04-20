import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const BIOME_PATH = "./tools/biome/node_modules/.bin/biome";
const RELEVANT_EXTENSION = /\.(?:css|js|json|jsonc|jsx|ts|tsx)$/;
const PATCH_FILE_LINE = /^\*\*\* (?:Add|Delete|Update) File: (.+)$/;

function collectCandidateFiles(value, files) {
  if (!value) return;

  if (typeof value === "string") {
    for (const line of value.split("\n")) {
      const match = line.match(PATCH_FILE_LINE);
      if (match) files.add(match[1]);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectCandidateFiles(item, files);
    return;
  }

  if (typeof value === "object") {
    if (typeof value.file_path === "string") files.add(value.file_path);
    if (typeof value.patch === "string") collectCandidateFiles(value.patch, files);
  }
}

function normalizeFile(file) {
  return path.isAbsolute(file) ? file : path.resolve(process.cwd(), file);
}

const input = fs.readFileSync(0, "utf8");
const payload = JSON.parse(input);
const candidateFiles = new Set();

collectCandidateFiles(payload.tool_input, candidateFiles);

const filesToFormat = [...candidateFiles]
  .map(normalizeFile)
  .filter((file) => RELEVANT_EXTENSION.test(file))
  .filter((file) => fs.existsSync(file));

if (filesToFormat.length === 0) process.exit(0);
if (!fs.existsSync(BIOME_PATH)) process.exit(0);

for (const file of filesToFormat) {
  try {
    execFileSync(
      BIOME_PATH,
      [
        "check",
        "--write",
        "--enforce-assist=true",
        "--config-path",
        "biome.json",
        file,
      ],
      {
        cwd: process.cwd(),
        stdio: "ignore",
      },
    );
  } catch {
    // Keep hook failures non-blocking, matching the original Claude setup.
  }
}
