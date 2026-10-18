import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const helper = fileURLToPath(new URL("../scripts/ci/archive-failure-traces.mjs", import.meta.url));
const cap = 8 * 1024 * 1024;
const sha = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "caring-trace-cap-"));
  const input = path.join(root, "test-results");
  const output = path.join(root, "playwright-traces.tar");
  function cleanup() {
    const resolvedRoot = realpathSync(root);
    const resolvedTemp = realpathSync(os.tmpdir());
    const within = path.relative(resolvedTemp, resolvedRoot);
    assert.ok(within.startsWith("caring-trace-cap-") && !within.includes(".."), "safe temporary cleanup");
    rmSync(resolvedRoot, { recursive: true, force: true });
  }
  return { root, input, output, cleanup };
}

function run(input, output, maxBytes = cap) {
  return spawnSync(process.execPath, [helper, "--input", input, "--output", output, "--max-bytes", String(maxBytes)], {
    encoding: "utf8",
    timeout: 20_000,
  });
}

test("admits one complete archive, including hidden and nested files, without changing inputs", (t) => {
  const f = fixture();
  t.after(f.cleanup);
  mkdirSync(path.join(f.input, "nested", "empty"), { recursive: true });
  mkdirSync(path.join(f.input, ".hidden"));
  const files = ["summary.txt", "nested/trace.zip", ".hidden/metadata.json"];
  writeFileSync(path.join(f.input, files[0]), "synthetic summary");
  writeFileSync(path.join(f.input, files[1]), Buffer.from([0, 255, 12, 27]));
  writeFileSync(path.join(f.input, files[2]), '{"synthetic":true}');
  const before = files.map((file) => sha(path.join(f.input, file)));
  const result = run(f.input, f.output);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(statSync(f.output).size <= cap);
  const extracted = path.join(f.root, "extracted");
  mkdirSync(extracted);
  const unpacked = spawnSync("tar", ["-xf", f.output, "-C", extracted], { encoding: "utf8" });
  assert.equal(unpacked.status, 0, unpacked.stderr);
  assert.ok(existsSync(path.join(extracted, "test-results", "nested", "empty")));
  assert.deepEqual(
    files.map((file) => sha(path.join(extracted, "test-results", file))),
    before,
  );
  assert.deepEqual(
    files.map((file) => sha(path.join(f.input, file))),
    before,
  );
});

test("oversized complete archive is refused and no upload input exists", (t) => {
  const f = fixture();
  t.after(f.cleanup);
  mkdirSync(f.input);
  const trace = path.join(f.input, "large.trace");
  writeFileSync(trace, Buffer.alloc(cap + 1, 7));
  const before = sha(trace);
  const result = run(f.input, f.output);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /exceeds/);
  assert.equal(existsSync(f.output), false);
  assert.equal(sha(trace), before);
});

test("missing or empty traces refuse admission without an output", (t) => {
  const f = fixture();
  t.after(f.cleanup);
  assert.equal(run(f.input, f.output).status, 1);
  assert.equal(existsSync(f.output), false);
  mkdirSync(path.join(f.input, "nested"), { recursive: true });
  const result = run(f.input, f.output);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /No trace files/);
  assert.equal(existsSync(f.output), false);
  assert.ok(existsSync(path.join(f.input, "nested")));
});

test("stale output and output inside inputs are refused without overwriting traces", (t) => {
  const f = fixture();
  t.after(f.cleanup);
  mkdirSync(f.input);
  writeFileSync(path.join(f.input, "trace.txt"), "synthetic trace");
  writeFileSync(f.output, "existing output");
  assert.equal(run(f.input, f.output).status, 1);
  assert.equal(readFileSync(f.output, "utf8"), "existing output");
  const inside = path.join(f.input, "archive.tar");
  assert.equal(run(f.input, inside).status, 1);
  assert.equal(existsSync(inside), false);
});

test("a descendant named ..child is still inside the trace input", (t) => {
  const f = fixture();
  t.after(f.cleanup);
  const descendant = path.join(f.input, "..child");
  mkdirSync(descendant, { recursive: true });
  const trace = path.join(f.input, "trace.txt");
  writeFileSync(trace, "synthetic trace");
  const before = sha(trace);
  const output = path.join(descendant, "archive.tar");
  const result = run(f.input, output);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /outside trace input/);
  assert.equal(existsSync(output), false);
  assert.equal(sha(trace), before);
});

test("linked trace input is refused rather than archiving an unrelated directory", (t) => {
  const f = fixture();
  t.after(f.cleanup);
  const unrelated = path.join(f.root, "unrelated");
  mkdirSync(unrelated);
  writeFileSync(path.join(unrelated, "outside.txt"), "synthetic unrelated content");
  try {
    symlinkSync(unrelated, f.input, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (["EPERM", "EACCES"].includes(error.code)) return t.skip("link creation unavailable");
    throw error;
  }
  assert.equal(run(f.input, f.output).status, 1);
  assert.equal(existsSync(f.output), false);
  assert.equal(readFileSync(path.join(unrelated, "outside.txt"), "utf8"), "synthetic unrelated content");
});
