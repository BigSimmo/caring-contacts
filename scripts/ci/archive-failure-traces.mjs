#!/usr/bin/env node
// Package every failure trace or admit none. The archive is the single upload input.
import { spawnSync } from "node:child_process";
import {
  lstatSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmdirSync,
  statSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1] || process.argv[index + 1].startsWith("--")) {
    throw new Error(`Expected ${name} value`);
  }
  return process.argv[index + 1];
}

function exists(file) {
  try {
    lstatSync(file);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function entries(directory, prefix) {
  const found = [];
  for (const name of readdirSync(directory).sort()) {
    if (name.includes("\n") || name.includes("\r")) throw new Error("Trace name cannot be verified");
    const file = path.join(directory, name);
    const relativeName = `${prefix}${name}`;
    const kind = lstatSync(file);
    if (kind.isDirectory()) {
      found.push(`${relativeName}/`, ...entries(file, `${relativeName}/`));
    } else if (kind.isFile()) {
      found.push(relativeName);
    } else {
      // Links and special files need a separate integrity contract; refuse the entire archive.
      throw new Error("Unsupported trace entry; refusing complete upload");
    }
  }
  return found;
}

function main() {
  const requestedInput = path.resolve(argument("--input"));
  if (!exists(requestedInput)) throw new Error("Trace input is missing");
  if (!lstatSync(requestedInput).isDirectory()) throw new Error("Trace input is not a real directory");
  const input = realpathSync(requestedInput);
  const output = path.resolve(argument("--output"));
  const maxBytes = Number(argument("--max-bytes"));
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error("Invalid archive byte cap");
  const outputParent = realpathSync(path.dirname(output));
  const relativeParent = path.relative(input, outputParent);
  const isOutsideParent = relativeParent === ".." || relativeParent.startsWith(`..${path.sep}`);
  if (relativeParent === "" || (!isOutsideParent && !path.isAbsolute(relativeParent))) {
    throw new Error("Archive output must be outside trace input");
  }
  if (exists(output)) throw new Error("Archive output already exists");
  const rootName = path.basename(input);
  const expected = [`${rootName}/`, ...entries(input, `${rootName}/`)];
  if (!expected.some((entry) => !entry.endsWith("/"))) throw new Error("No trace files to archive");

  const tempDirectory = mkdtempSync(path.join(outputParent, "trace-archive-"));
  const temporaryArchive = path.join(tempDirectory, "complete-traces.tar");
  try {
    const packed = spawnSync("tar", ["-cf", temporaryArchive, "-C", path.dirname(input), "--", rootName], {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    });
    if (packed.error || packed.status !== 0) throw new Error("tar failed; refusing upload");
    const actualBytes = statSync(temporaryArchive).size;
    if (actualBytes > maxBytes) throw new Error(`Complete trace archive exceeds ${maxBytes} bytes`);
    const listed = spawnSync("tar", ["-tf", temporaryArchive], {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    });
    if (listed.error || listed.status !== 0) throw new Error("Archive listing failed; refusing upload");
    const actual = listed.stdout.replaceAll("\r\n", "\n").trimEnd().split("\n").sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected.sort())) {
      throw new Error("Archive entries differ from complete trace input");
    }
    renameSync(temporaryArchive, output);
    console.log(`Complete trace archive admitted: ${actualBytes} bytes, ${expected.length - 1} entries`);
  } finally {
    if (exists(temporaryArchive)) unlinkSync(temporaryArchive);
    rmdirSync(tempDirectory);
  }
}

try {
  main();
} catch (error) {
  console.error(`Trace archive refused: ${error.message}`);
  process.exitCode = 1;
}
