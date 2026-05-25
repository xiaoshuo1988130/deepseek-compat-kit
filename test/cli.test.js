import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
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

test("lint-schema accepts DeepSeek-supported strict schema constraints", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dck-"));
  const schemaPath = path.join(dir, "schema.json");
  fs.writeFileSync(schemaPath, JSON.stringify({
    strict: true,
    parameters: {
      type: "object",
      properties: {
        code: { type: "string", pattern: "^[A-Z]+$", format: "regex" },
        score: { type: "number", minimum: 0, maximum: 10, multipleOf: 0.5 },
      },
      required: ["code", "score"],
      additionalProperties: false,
    },
  }));

  const result = spawnSync(process.execPath, [
    bin,
    "lint-schema",
    schemaPath,
    "--strict",
    "--base-url",
    "https://api.deepseek.com/beta",
  ], { encoding: "utf8" });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /schema ok/);
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

test("proxy injects cached reasoning_content before forwarding follow-up tool calls", async (t) => {
  const upstreamRequests = [];
  const upstream = http.createServer((request, response) => {
    collectRequestJson(request).then((body) => {
      upstreamRequests.push(body);
      response.writeHead(200, { "content-type": "application/json" });
      if (upstreamRequests.length === 1) {
        response.end(JSON.stringify({
          choices: [{
            message: {
              role: "assistant",
              reasoning_content: "cached private reasoning",
              tool_calls: [{
                id: "call_abc",
                type: "function",
                function: { name: "lookup", arguments: "{}" },
              }],
            },
          }],
        }));
        return;
      }

      response.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok" } }] }));
    }).catch((error) => {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: error.message }));
    });
  });

  const upstreamUrl = await listen(upstream);
  const proxyPort = await freePort();
  const proxy = spawn(process.execPath, [bin, "proxy", "--port", String(proxyPort), "--upstream", upstreamUrl], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  t.after(() => {
    proxy.kill();
    upstream.close();
  });

  await waitForOutput(proxy.stderr, /proxy alpha listening/);

  const proxyUrl = `http://127.0.0.1:${proxyPort}/v1/chat/completions`;
  const first = await fetch(proxyUrl, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer test" },
    body: JSON.stringify({ model: "deepseek-reasoner", messages: [{ role: "user", content: "first" }] }),
  });
  assert.equal(first.status, 200);
  await first.json();

  const second = await fetch(proxyUrl, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer test" },
    body: JSON.stringify({
      model: "deepseek-reasoner",
      messages: [{
        role: "assistant",
        tool_calls: [{
          id: "call_abc",
          type: "function",
          function: { name: "lookup", arguments: "{}" },
        }],
      }],
    }),
  });
  assert.equal(second.status, 200);
  assert.equal(second.headers.get("x-deepseek-compat-reasoning-injected"), "1");
  await second.json();

  assert.equal(upstreamRequests.length, 2);
  assert.equal(upstreamRequests[1].messages[0].reasoning_content, "cached private reasoning");
});

test("proxy deduplicates shared reasoning_content across multiple tool calls", async (t) => {
  const upstreamRequests = [];
  const upstream = http.createServer((request, response) => {
    collectRequestJson(request).then((body) => {
      upstreamRequests.push(body);
      response.writeHead(200, { "content-type": "application/json" });
      if (upstreamRequests.length === 1) {
        response.end(JSON.stringify({
          choices: [{
            message: {
              role: "assistant",
              reasoning_content: "shared reasoning",
              tool_calls: [
                { id: "call_one", type: "function", function: { name: "one", arguments: "{}" } },
                { id: "call_two", type: "function", function: { name: "two", arguments: "{}" } },
              ],
            },
          }],
        }));
        return;
      }

      response.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok" } }] }));
    }).catch((error) => {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: error.message }));
    });
  });

  const upstreamUrl = await listen(upstream);
  const proxyPort = await freePort();
  const proxy = spawn(process.execPath, [bin, "proxy", "--port", String(proxyPort), "--upstream", upstreamUrl], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  t.after(() => {
    proxy.kill();
    upstream.close();
  });

  await waitForOutput(proxy.stderr, /proxy alpha listening/);

  const proxyUrl = `http://127.0.0.1:${proxyPort}/v1/chat/completions`;
  await fetch(proxyUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "deepseek-reasoner", messages: [{ role: "user", content: "first" }] }),
  });

  const second = await fetch(proxyUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "deepseek-reasoner",
      messages: [{
        role: "assistant",
        tool_calls: [
          { id: "call_one", type: "function", function: { name: "one", arguments: "{}" } },
          { id: "call_two", type: "function", function: { name: "two", arguments: "{}" } },
        ],
      }],
    }),
  });
  assert.equal(second.status, 200);
  await second.json();

  assert.equal(upstreamRequests.length, 2);
  assert.equal(upstreamRequests[1].messages[0].reasoning_content, "shared reasoning");
});

function collectRequestJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

async function freePort() {
  const server = http.createServer();
  const url = await listen(server);
  const port = Number(new URL(url).port);
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function waitForOutput(stream, pattern) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`timed out waiting for ${pattern}; output was: ${output}`));
    }, 5000);

    function onData(chunk) {
      output += chunk.toString();
      if (pattern.test(output)) {
        cleanup();
        resolve();
      }
    }

    function cleanup() {
      clearTimeout(timeout);
      stream.off("data", onData);
    }

    stream.on("data", onData);
  });
}
