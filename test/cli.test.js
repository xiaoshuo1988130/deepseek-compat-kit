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

test("compile-schema writes DeepSeek strict schema and loss report", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dck-"));
  const schemaPath = path.join(dir, "schema.json");
  const outPath = path.join(dir, "deepseek.schema.json");
  const reportPath = path.join(dir, "report.json");
  fs.writeFileSync(schemaPath, JSON.stringify({
    type: "function",
    function: {
      name: "search",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", minLength: 2, maxLength: 80 },
          tags: {
            type: "array",
            minItems: 1,
            maxItems: 3,
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
              },
            },
          },
        },
        required: ["query"],
      },
    },
  }));

  const result = spawnSync(process.execPath, [
    bin,
    "compile-schema",
    "-i",
    schemaPath,
    "-o",
    outPath,
    "--report",
    reportPath,
  ], { encoding: "utf8" });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /wrote DeepSeek strict schema/);

  const compiled = JSON.parse(fs.readFileSync(outPath, "utf8"));
  const parameters = compiled.function.parameters;
  assert.deepEqual(parameters.required, ["query", "tags"]);
  assert.equal(parameters.additionalProperties, false);
  assert.equal(parameters.properties.query.minLength, undefined);
  assert.equal(parameters.properties.query.maxLength, undefined);
  assert.equal(parameters.properties.tags.minItems, undefined);
  assert.equal(parameters.properties.tags.maxItems, undefined);
  assert.deepEqual(parameters.properties.tags.items.required, ["name"]);
  assert.equal(parameters.properties.tags.items.additionalProperties, false);

  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  assert.equal(report.summary.removed_constraints, 4);
  assert.equal(report.summary.required_added, 2);
  assert.equal(report.summary.additional_properties_fixed, 2);
  assert.match(report.system_prompt_appendix, /minimum string length of 2/);
  assert.match(report.system_prompt_appendix, /at most 3 item/);
});

test("compile-schema dry-run prints repair plan without writing files", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dck-"));
  const schemaPath = path.join(dir, "schema.json");
  const outPath = path.join(dir, "deepseek.schema.json");
  const reportPath = path.join(dir, "report.json");
  fs.writeFileSync(schemaPath, JSON.stringify({
    parameters: {
      type: "object",
      properties: {
        username: { type: "string", minLength: 3 },
        count: { type: "number" },
      },
      required: ["username"],
    },
  }));

  const result = spawnSync(process.execPath, [
    bin,
    "compile-schema",
    "-i",
    schemaPath,
    "-o",
    outPath,
    "--report",
    reportPath,
    "--dry-run",
  ], { encoding: "utf8" });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /compile-schema dry run; no files written/);
  assert.match(result.stdout, /planned_changes/);
  assert.match(result.stdout, /REMOVE \$\.properties\.username\.minLength/);
  assert.match(result.stdout, /ADD \$\.required: count/);
  assert.match(result.stdout, /SET \$\.additionalProperties: false/);
  assert.match(result.stdout, /post_validation: properties\.username must have a minimum string length of 3/);
  assert.equal(fs.existsSync(outPath), false);
  assert.equal(fs.existsSync(reportPath), false);
});

test("probe writes endpoint capability report against mock upstream", async (t) => {
  const mock = http.createServer((request, response) => {
    collectRequestJson(request).then((body) => {
      const pathname = new URL(request.url, "http://127.0.0.1").pathname;
      if (request.method !== "POST" || pathname !== "/chat/completions") {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { message: "not found" } }));
        return;
      }

      if (body.stream) {
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "ok" } }] })}\n\n`);
        response.write("data: [DONE]\n\n");
        response.end();
        return;
      }

      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok" } }] }));
    }).catch((error) => {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: error.message }));
    });
  });

  const upstreamUrl = await listen(mock);
  t.after(() => mock.close());

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dck-"));
  const reportPath = path.join(dir, "capability-report.json");
  const markdownPath = path.join(dir, "Capability_Report.md");
  const result = await runNode([
    bin,
    "probe",
    "--endpoint",
    upstreamUrl,
    "--model",
    "mock-model",
    "--profile",
    "relay",
    "--out",
    reportPath,
    "--markdown",
    markdownPath,
  ]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /wrote capability report/);
  assert.match(result.stdout, /wrote markdown capability report/);

  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  assert.equal(report.profile, "relay");
  assert.equal(report.profile_guidance.name, "Third-party relay or API gateway");
  assert.match(report.profile_guidance.strict_schema_hint, /relay preserves DeepSeek strict schema semantics/);
  assert.equal(report.summary.status, "PASS");
  assert.equal(report.summary.passed, 3);
  assert.deepEqual(report.summary.capabilities, {
    chat_completions: "PASS",
    streaming: "PASS",
    strict_schema: "PASS",
  });
  assert.deepEqual(report.checks.map((check) => check.name), [
    "chat_completions",
    "streaming",
    "strict_schema_request",
  ]);
  assert.deepEqual(report.checks.map((check) => check.capability), [
    "chat_completions",
    "streaming",
    "strict_schema",
  ]);
  assert.match(report.checks[2].recommendation, /compile-schema/);

  const markdown = fs.readFileSync(markdownPath, "utf8");
  assert.match(markdown, /# DeepSeek CompatKit Capability Report/);
  assert.match(markdown, /## Profile Guidance/);
  assert.match(markdown, /Third-party relay or API gateway/);
  assert.match(markdown, /Status: \*\*PASS\*\*/);
  assert.match(markdown, /\| `chat_completions` \| `chat_completions` \| PASS \| 200 \|/);
  assert.match(markdown, /## Recommendations/);
  assert.match(markdown, /No immediate compatibility issues/);
});

test("probe rejects unknown profiles before network calls", async () => {
  const result = await runNode([
    bin,
    "probe",
    "--endpoint",
    "http://127.0.0.1:1",
    "--profile",
    "mystery",
  ]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Unknown probe profile/);
});

test("inventory reports DeepSeek hints without leaking secret values", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dck-"));
  const reportPath = path.join(dir, "inventory.json");
  const markdownPath = path.join(dir, "inventory.md");
  fs.mkdirSync(path.join(dir, "node_modules"));
  fs.writeFileSync(path.join(dir, "node_modules", "ignored.js"), "const model = 'deepseek-ignored';\n");
  fs.writeFileSync(path.join(dir, ".env"), [
    "DEEPSEEK_API_KEY=sk-supersecretvalue1234567890",
    "OPENAI_API_KEY=sk-anothersecretvalue1234567890",
  ].join("\n"));
  fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({
    model: "deepseek-chat",
    baseURL: "http://127.0.0.1:8787/v1",
  }, null, 2));

  const result = spawnSync(process.execPath, [
    bin,
    "inventory",
    "--path",
    dir,
    "--out",
    reportPath,
    "--markdown",
    markdownPath,
  ], { encoding: "utf8" });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /wrote inventory report/);
  assert.match(result.stdout, /wrote markdown inventory report/);

  const reportText = fs.readFileSync(reportPath, "utf8");
  const markdown = fs.readFileSync(markdownPath, "utf8");
  assert.doesNotMatch(reportText, /supersecretvalue/);
  assert.doesNotMatch(markdown, /supersecretvalue/);
  assert.doesNotMatch(reportText, /anothersecretvalue/);
  assert.match(reportText, /DSK_INV_SECRET_PRESENT/);
  assert.match(reportText, /DSK_INV_BASE_URL/);
  assert.match(reportText, /deepseek-chat/);
  assert.doesNotMatch(reportText, /deepseek-ignored/);

  const report = JSON.parse(reportText);
  assert.equal(report.summary.warnings, 4);
  assert.equal(report.summary.base_urls, 1);
  assert.equal(report.summary.models, 1);
  assert.match(markdown, /# DeepSeek CompatKit Inventory Report/);
});

test("recipes lists and prints the OpenCode recipe", () => {
  const list = spawnSync(process.execPath, [bin, "recipes"], { encoding: "utf8" });
  assert.equal(list.status, 0);
  assert.match(list.stdout, /opencode/);
  assert.match(list.stdout, /cline/);
  assert.match(list.stdout, /roo-code/);
  assert.match(list.stdout, /openai-js/);
  assert.match(list.stdout, /langchain-js/);

  const recipe = spawnSync(process.execPath, [bin, "recipes", "opencode"], { encoding: "utf8" });
  assert.equal(recipe.status, 0);
  assert.match(recipe.stdout, /OpenCode \+ DeepSeek CompatKit Recipe/);
  assert.match(recipe.stdout, /http:\/\/127\.0\.0\.1:8787\/v1/);
  assert.match(recipe.stdout, /compile-schema/);
  assert.match(recipe.stdout, /does not edit OpenCode configuration files/);
});

test("recipes and doctor support Cline adoption", () => {
  const recipe = spawnSync(process.execPath, [bin, "recipes", "cline"], { encoding: "utf8" });
  assert.equal(recipe.status, 0);
  assert.match(recipe.stdout, /Cline \+ DeepSeek CompatKit Recipe/);
  assert.match(recipe.stdout, /Base URL: http:\/\/127\.0\.0\.1:8787\/v1/);
  assert.match(recipe.stdout, /does not edit VS Code, Cline, or extension storage files/);

  const doctor = spawnSync(process.execPath, [bin, "doctor", "--target", "cline", "--print"], { encoding: "utf8" });
  assert.equal(doctor.status, 0);
  assert.match(doctor.stdout, /DeepSeek CompatKit Doctor: Cline/);
  assert.match(doctor.stdout, /OpenAI-compatible provider path/);
});

test("recipes and doctor support Roo Code adoption", () => {
  const recipe = spawnSync(process.execPath, [bin, "recipes", "roo-code"], { encoding: "utf8" });
  assert.equal(recipe.status, 0);
  assert.match(recipe.stdout, /Roo Code \+ DeepSeek CompatKit Recipe/);
  assert.match(recipe.stdout, /Base URL: http:\/\/127\.0\.0\.1:8787\/v1/);
  assert.match(recipe.stdout, /does not edit VS Code, Roo Code, or extension storage files/);

  const doctor = spawnSync(process.execPath, [bin, "doctor", "--target", "roo", "--print"], { encoding: "utf8" });
  assert.equal(doctor.status, 0);
  assert.match(doctor.stdout, /DeepSeek CompatKit Doctor: Roo Code/);
  assert.match(doctor.stdout, /OpenAI-compatible provider path/);
});

test("recipes and doctor support OpenAI JS SDK adoption", () => {
  const recipe = spawnSync(process.execPath, [bin, "recipes", "openai-js"], { encoding: "utf8" });
  assert.equal(recipe.status, 0);
  assert.match(recipe.stdout, /OpenAI JS SDK \+ DeepSeek CompatKit Recipe/);
  assert.match(recipe.stdout, /baseURL: process\.env\.DEEPSEEK_BASE_URL/);
  assert.match(recipe.stdout, /compile-schema -i \.\/tools\.schema\.json --dry-run/);

  const doctor = spawnSync(process.execPath, [bin, "doctor", "--target", "openai-js", "--print"], { encoding: "utf8" });
  assert.equal(doctor.status, 0);
  assert.match(doctor.stdout, /DeepSeek CompatKit Doctor: OpenAI JS SDK/);
  assert.match(doctor.stdout, /OpenAI JS SDK \+ DeepSeek CompatKit Recipe/);
});

test("recipes and doctor support LangChain JS adoption", () => {
  const recipe = spawnSync(process.execPath, [bin, "recipes", "langchain-js"], { encoding: "utf8" });
  assert.equal(recipe.status, 0);
  assert.match(recipe.stdout, /LangChain JS \+ DeepSeek CompatKit Recipe/);
  assert.match(recipe.stdout, /configuration: \{/);
  assert.match(recipe.stdout, /baseURL: process\.env\.DEEPSEEK_BASE_URL/);

  const doctor = spawnSync(process.execPath, [bin, "doctor", "--target", "langchain-js", "--print"], { encoding: "utf8" });
  assert.equal(doctor.status, 0);
  assert.match(doctor.stdout, /DeepSeek CompatKit Doctor: LangChain JS/);
  assert.match(doctor.stdout, /@langchain\/openai/);
});

test("doctor prints a no-write OpenCode prescription", () => {
  const result = spawnSync(process.execPath, [bin, "doctor", "--target", "opencode", "--print"], { encoding: "utf8" });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Mode: print-only adoption report/);
  assert.match(result.stdout, /No configuration files were modified/);
  assert.match(result.stdout, /live end-to-end validation is pending/);
  assert.match(result.stdout, /No local inventory path was provided/);
  assert.match(result.stdout, /probe --endpoint http:\/\/127\.0\.0\.1:8787/);
});

test("doctor can combine inventory summary with a target recipe", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dck-"));
  const doctorPath = path.join(dir, "DeepSeek_Doctor.md");
  fs.writeFileSync(path.join(dir, ".env"), "DEEPSEEK_API_KEY=sk-doctorsecretvalue1234567890\n");
  fs.writeFileSync(path.join(dir, "opencode.json"), JSON.stringify({
    model: "deepseek-chat",
    baseURL: "http://127.0.0.1:8787/v1",
  }, null, 2));

  const result = spawnSync(process.execPath, [
    bin,
    "doctor",
    "--target",
    "opencode",
    "--path",
    dir,
    "--markdown",
    doctorPath,
  ], { encoding: "utf8" });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /wrote doctor report/);

  const report = fs.readFileSync(doctorPath, "utf8");
  assert.match(report, /# DeepSeek CompatKit Doctor: OpenCode/);
  assert.match(report, /## Local Inventory Summary/);
  assert.match(report, /Warnings: 2/);
  assert.match(report, /deepseek-chat/);
  assert.match(report, /## Target Recipe/);
  assert.match(report, /OpenCode \+ DeepSeek CompatKit Recipe/);
  assert.doesNotMatch(report, /doctorsecretvalue/);
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

function runNode(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (status) => {
      resolve({ status, stdout, stderr });
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
