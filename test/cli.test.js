import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const bin = path.resolve("bin/deepseek-compat-kit.js");

test("lint-schema reports DeepSeek strict-mode object requirements", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dck-"));
  const schemaPath = path.join(dir, "schema.json");
  fs.writeFileSync(schemaPath, JSON.stringify({
    strict: true,
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 2 },
      },
      required: [],
    },
  }));

  const result = spawnSync(process.execPath, [bin, "lint-schema", schemaPath, "--strict"], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /DSK_SCHEMA_001/);
  assert.match(result.stdout, /DSK_SCHEMA_002/);
  assert.match(result.stdout, /DSK_SCHEMA_003/);
  assert.match(result.stdout, /DSK_SCHEMA_004/);
});

test("diagnose detects dropped reasoning_content", () => {
  const result = spawnSync(process.execPath, [bin, "diagnose", "fixtures/tool-calls/reasoning-content-lost.jsonl"], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /DSK_REASONING_001/);
});

test("sanitize redacts reasoning_content and tool results", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dck-"));
  const input = path.join(dir, "run.jsonl");
  const output = path.join(dir, "safe.jsonl");
  fs.writeFileSync(input, [
    JSON.stringify({ type: "response", message: { role: "assistant", reasoning_content: "private thoughts", authorization: "Bearer secret" } }),
    JSON.stringify({ type: "tool_result", message: { role: "tool", content: "private tool result xiaoshuo1988130@gmail.com" } }),
  ].join("\n"));

  execFileSync(process.execPath, [bin, "sanitize", input, "--out", output]);
  const safe = fs.readFileSync(output, "utf8");
  assert.match(safe, /redacted:reasoning_content/);
  assert.match(safe, /redacted:tool_result/);
  assert.doesNotMatch(safe, /private thoughts/);
  assert.doesNotMatch(safe, /private tool result/);
  assert.doesNotMatch(safe, /xiaoshuo1988130@gmail.com/);
});
