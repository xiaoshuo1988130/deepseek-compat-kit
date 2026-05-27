import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const bin = path.resolve("bin/deepseek-compat-kit.js");

test("CLI prints package version", () => {
  const expectedVersion = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
  for (const flag of ["--version", "-v", "version"]) {
    const result = spawnSync(process.execPath, [bin, flag], { encoding: "utf8" });
    assert.equal(result.status, 0, flag);
    assert.equal(result.stdout.trim(), `deepseek-compat-kit ${expectedVersion}`);
    assert.equal(result.stderr, "");
  }
});

test("npm package includes docs and runnable examples without vendored installs", () => {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(npmCommand, ["pack", "--dry-run", "--json"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);

  const [pack] = JSON.parse(result.stdout);
  const files = new Set(pack.files.map((file) => file.path));
  assert.ok(files.has("README.md"));
  assert.ok(files.has("README.zh-CN.md"));
  assert.ok(files.has("docs/real-endpoint-validation.md"));
  assert.ok(files.has("docs/examples/provider-matrix.example.md"));
  assert.ok(files.has("docs/recipes/openrouter-deepseek.md"));
  assert.ok(files.has("examples/mock-upstream/server.mjs"));
  assert.ok(files.has("examples/mock-upstream/smoke.mjs"));
  assert.ok(files.has("examples/openai-js-tool-calls/smoke.mjs"));
  assert.ok(files.has("examples/openai-js/index.mjs"));
  assert.ok(files.has("examples/claude-code/README.md"));

  for (const file of files) {
    assert.doesNotMatch(file, /(^|\/)node_modules\//);
  }
});

test("top-level help supports command topics", () => {
  const result = spawnSync(process.execPath, [bin, "help", "probe"], { encoding: "utf8" });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: deepseek-compat-kit probe --endpoint/);
  assert.doesNotMatch(result.stdout, /Commands:/);
  assert.equal(result.stderr, "");

  const topLevel = spawnSync(process.execPath, [bin, "help"], { encoding: "utf8" });
  assert.equal(topLevel.status, 0);
  assert.match(topLevel.stdout, /--version \| -v \| version/);
});

test("commands print command-specific help without side effects", () => {
  const commands = [
    "compile-schema",
    "probe",
    "matrix",
    "inventory",
    "doctor",
    "recipes",
    "lint-schema",
    "diagnose",
    "replay",
    "sanitize",
    "proxy",
  ];

  for (const command of commands) {
    const result = spawnSync(process.execPath, [bin, command, "--help"], { encoding: "utf8" });
    assert.equal(result.status, 0, command);
    assert.match(result.stdout, new RegExp(`Usage: deepseek-compat-kit ${command}`));
    assert.equal(result.stderr, "");
  }
});

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

test("lint-schema positional input ignores preceding option values", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dck-"));
  const schemaPath = path.join(dir, "schema.json");
  fs.writeFileSync(schemaPath, JSON.stringify({
    strict: true,
    parameters: {
      type: "object",
      properties: {
        code: { type: "string" },
      },
      required: ["code"],
      additionalProperties: false,
    },
  }));

  const result = spawnSync(process.execPath, [
    bin,
    "lint-schema",
    "--strict",
    "--base-url",
    "https://api.deepseek.com/beta",
    schemaPath,
  ], { encoding: "utf8" });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /schema ok/);
});

test("compile-schema writes DeepSeek strict schema and loss report", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dck-"));
  const schemaPath = path.join(dir, "schema.json");
  const outPath = path.join(dir, "deepseek.schema.json");
  const reportPath = path.join(dir, "report.json");
  const markdownPath = path.join(dir, "report.md");
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
    "--markdown",
    markdownPath,
  ], { encoding: "utf8" });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /wrote DeepSeek strict schema/);
  assert.match(result.stdout, /wrote markdown compile report/);

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

  const markdown = fs.readFileSync(markdownPath, "utf8");
  assert.match(markdown, /# DeepSeek CompatKit Schema Compile Report/);
  assert.match(markdown, /Removed constraints: 4/);
  assert.match(markdown, /\| `\$\.properties\.query\.minLength` \| `minLength` \| `2` \|/);
  assert.match(markdown, /System Prompt Appendix/);
  assert.match(markdown, /minimum string length of 2/);
  assert.match(markdown, /Post-validation Plan/);
});

test("compile-schema dry-run prints repair plan without writing files", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dck-"));
  const schemaPath = path.join(dir, "schema.json");
  const outPath = path.join(dir, "deepseek.schema.json");
  const reportPath = path.join(dir, "report.json");
  const markdownPath = path.join(dir, "report.md");
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
    "--markdown",
    markdownPath,
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
  assert.equal(fs.existsSync(markdownPath), false);
});

test("compile-schema positional input ignores preceding option values", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dck-"));
  const schemaPath = path.join(dir, "schema.json");
  const reportPath = path.join(dir, "nested", "report.json");
  fs.writeFileSync(schemaPath, JSON.stringify({
    type: "object",
    properties: {
      query: { type: "string", minLength: 2 },
    },
  }));

  const result = spawnSync(process.execPath, [
    bin,
    "compile-schema",
    "--report",
    reportPath,
    schemaPath,
  ], { encoding: "utf8" });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /"type": "object"/);
  assert.match(result.stdout, /"additionalProperties": false/);
  assert.match(result.stdout, /wrote compile report/);
  assert.equal(fs.existsSync(reportPath), true);
});

test("compile-schema check fails when schema needs repairs", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dck-"));
  const schemaPath = path.join(dir, "schema.json");
  const outPath = path.join(dir, "deepseek.schema.json");
  fs.writeFileSync(schemaPath, JSON.stringify({
    parameters: {
      type: "object",
      properties: {
        username: { type: "string", minLength: 3 },
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
    "--check",
  ], { encoding: "utf8" });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /compile-schema check; no files written/);
  assert.match(result.stdout, /REMOVE \$\.properties\.username\.minLength/);
  assert.match(result.stdout, /ADD \$\.required: username/);
  assert.match(result.stdout, /SET \$\.additionalProperties: false/);
  assert.match(result.stdout, /schema requires DeepSeek strict-mode repairs/);
  assert.equal(fs.existsSync(outPath), false);
});

test("compile-schema check passes when schema is already compatible", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dck-"));
  const schemaPath = path.join(dir, "schema.json");
  fs.writeFileSync(schemaPath, JSON.stringify({
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
      },
      required: ["query"],
      additionalProperties: false,
    },
  }));

  const result = spawnSync(process.execPath, [
    bin,
    "compile-schema",
    "-i",
    schemaPath,
    "--check",
  ], { encoding: "utf8" });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /compile-schema check; no files written/);
  assert.match(result.stdout, /planned_changes:\n- none/);
  assert.match(result.stdout, /schema already DeepSeek strict-mode compatible/);
});

test("probe writes endpoint capability report against mock upstream", async (t) => {
  const requestBodies = [];
  const requestHeaders = [];
  const mock = http.createServer((request, response) => {
    collectRequestJson(request).then((body) => {
      requestBodies.push(body);
      requestHeaders.push(request.headers);
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

      if (body.tool_choice?.function?.name === "record_query") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({
          choices: [{
            message: {
              role: "assistant",
              tool_calls: [{
                id: "call_probe_query",
                type: "function",
                function: {
                  name: "record_query",
                  arguments: "{\"query\":\"compatibility\"}",
                },
              }],
            },
          }],
        }));
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
    "--name",
    "Mock Relay",
    "--profile",
    "relay",
    "--header",
    "HTTP-Referer: https://example.com/deepseek-compat-kit",
    "--header",
    "X-Title: DeepSeek CompatKit Probe",
    "--header-env",
    "X-Relay-Token=DSCK_RELAY_TOKEN",
    "--out",
    reportPath,
    "--markdown",
    markdownPath,
  ], { env: { DSCK_RELAY_TOKEN: "relay-token-should-not-leak" } });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /wrote capability report/);
  assert.match(result.stdout, /wrote markdown capability report/);
  assert.match(result.stdout, /probe summary: PASS \(4 passed, 0 warned, 0 failed\)/);
  assert.match(result.stdout, /capabilities: chat_completions=PASS, streaming=PASS, multi_turn_tool_messages=PASS, strict_schema=PASS/);
  assert.match(result.stdout, /no immediate capability issues detected/);

  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  assert.equal(report.name, "Mock Relay");
  assert.equal(report.profile, "relay");
  assert.equal(report.timeout_ms, 15000);
  assert.equal(report.fail_on_warn, false);
  assert.deepEqual(report.extra_headers, {
    count: 3,
    names: ["x-relay-token", "http-referer", "x-title"],
    env: [{ name: "x-relay-token", env: "DSCK_RELAY_TOKEN", present: true }],
  });
  assert.doesNotMatch(JSON.stringify(report), /relay-token-should-not-leak/);
  assert.equal(report.profile_guidance.name, "Third-party relay or API gateway");
  assert.match(report.profile_guidance.strict_schema_hint, /relay preserves DeepSeek strict schema semantics/);
  assert.equal(report.summary.status, "PASS");
  assert.equal(report.summary.passed, 4);
  assert.deepEqual(report.summary.capabilities, {
    chat_completions: "PASS",
    streaming: "PASS",
    multi_turn_tool_messages: "PASS",
    strict_schema: "PASS",
  });
  assert.deepEqual(report.checks.map((check) => check.name), [
    "chat_completions",
    "streaming",
    "multi_turn_tool_messages",
    "strict_schema_request",
  ]);
  assert.deepEqual(report.checks.map((check) => check.capability), [
    "chat_completions",
    "streaming",
    "multi_turn_tool_messages",
    "strict_schema",
  ]);
  assert.match(report.checks[2].recommendation, /reasoning_content/);
  assert.match(report.checks[3].recommendation, /compile-schema/);
  assert.ok(requestBodies.some((body) => body.messages?.some((message) => message.reasoning_content)));
  assert.ok(requestBodies.some((body) => body.messages?.some((message) => message.role === "tool" && message.tool_call_id === "call_probe_weather")));
  assert.ok(requestHeaders.every((headers) => headers["http-referer"] === "https://example.com/deepseek-compat-kit"));
  assert.ok(requestHeaders.every((headers) => headers["x-title"] === "DeepSeek CompatKit Probe"));
  assert.ok(requestHeaders.every((headers) => headers["x-relay-token"] === "relay-token-should-not-leak"));

  const markdown = fs.readFileSync(markdownPath, "utf8");
  assert.match(markdown, /# DeepSeek CompatKit Capability Report/);
  assert.match(markdown, /Name: `Mock Relay`/);
  assert.match(markdown, /## Execution Context/);
  assert.match(markdown, /API key env: `DEEPSEEK_API_KEY`/);
  assert.match(markdown, /API key present: no/);
  assert.match(markdown, /Extra headers: `x-relay-token`, `http-referer`, `x-title`/);
  assert.match(markdown, /Extra header env vars: `x-relay-token=DSCK_RELAY_TOKEN`/);
  assert.doesNotMatch(markdown, /relay-token-should-not-leak/);
  assert.match(markdown, /Checks requested: `chat_completions`, `streaming`, `multi_turn_tool_messages`, `strict_schema`/);
  assert.match(markdown, /Timeout: 15000 ms/);
  assert.match(markdown, /Fail on warn: no/);
  assert.match(markdown, /Baseline: none/);
  assert.match(markdown, /Fail on regression: no/);
  assert.match(markdown, /## Profile Guidance/);
  assert.match(markdown, /Third-party relay or API gateway/);
  assert.match(markdown, /Status: \*\*PASS\*\*/);
  assert.match(markdown, /\| `chat_completions` \| `chat_completions` \| PASS \| 200 \|/);
  assert.match(markdown, /\| `multi_turn_tool_messages` \| `multi_turn_tool_messages` \| PASS \| 200 \|/);
  assert.match(markdown, /## Recommendations/);
  assert.match(markdown, /No immediate compatibility issues/);
});

test("probe can run a selected subset of checks", async (t) => {
  const requestBodies = [];
  const mock = http.createServer((request, response) => {
    collectRequestJson(request).then((body) => {
      requestBodies.push(body);
      const pathname = new URL(request.url, "http://127.0.0.1").pathname;
      if (request.method !== "POST" || pathname !== "/chat/completions") {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { message: "not found" } }));
        return;
      }

      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        choices: [{
          message: {
            role: "assistant",
            tool_calls: [{
              id: "call_probe_query",
              type: "function",
              function: {
                name: "record_query",
                arguments: "{\"query\":\"compatibility\"}",
              },
            }],
          },
        }],
      }));
    }).catch((error) => {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: error.message }));
    });
  });

  const upstreamUrl = await listen(mock);
  t.after(() => mock.close());

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dck-"));
  const reportPath = path.join(dir, "selected-capability-report.json");
  const result = await runNode([
    bin,
    "probe",
    "--endpoint",
    upstreamUrl,
    "--model",
    "mock-model",
    "--checks",
    "strict",
    "--out",
    reportPath,
  ]);

  assert.equal(result.status, 0);
  assert.equal(requestBodies.length, 1);
  assert.equal(requestBodies[0].tool_choice?.function?.name, "record_query");

  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  assert.deepEqual(report.checks_requested, ["strict_schema"]);
  assert.equal(report.summary.status, "PASS");
  assert.equal(report.summary.passed, 1);
  assert.deepEqual(report.summary.capabilities, {
    strict_schema: "PASS",
  });
  assert.deepEqual(report.checks.map((check) => check.capability), ["strict_schema"]);
});

test("probe expands check presets", async (t) => {
  const requestBodies = [];
  const mock = http.createServer((request, response) => {
    collectRequestJson(request).then((body) => {
      requestBodies.push(body);
      const pathname = new URL(request.url, "http://127.0.0.1").pathname;
      if (request.method !== "POST" || pathname !== "/chat/completions") {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { message: "not found" } }));
        return;
      }

      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        choices: [{
          message: {
            role: "assistant",
            tool_calls: [{
              id: "call_probe_query",
              type: "function",
              function: {
                name: "record_query",
                arguments: "{\"query\":\"compatibility\"}",
              },
            }],
          },
        }],
      }));
    }).catch((error) => {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: error.message }));
    });
  });

  const upstreamUrl = await listen(mock);
  t.after(() => mock.close());

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dck-"));
  const reportPath = path.join(dir, "preset-capability-report.json");
  const result = await runNode([
    bin,
    "probe",
    "--endpoint",
    upstreamUrl,
    "--model",
    "mock-model",
    "--checks",
    "agent",
    "--out",
    reportPath,
  ]);

  assert.equal(result.status, 0);
  assert.equal(requestBodies.length, 2);
  assert.ok(requestBodies.some((body) => body.messages?.some((message) => message.reasoning_content)));
  assert.ok(requestBodies.some((body) => body.tool_choice?.function?.name === "record_query"));

  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  assert.deepEqual(report.checks_requested, ["multi_turn_tool_messages", "strict_schema"]);
  assert.equal(report.summary.status, "PASS");
  assert.deepEqual(report.checks.map((check) => check.capability), ["multi_turn_tool_messages", "strict_schema"]);
});

test("probe warns when strict schema response lacks tool calls", async (t) => {
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
  const result = await runNode([
    bin,
    "probe",
    "--endpoint",
    upstreamUrl,
    "--model",
    "mock-model",
    "--out",
    reportPath,
  ]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /probe summary: WARN \(3 passed, 1 warned, 0 failed\)/);
  assert.match(result.stdout, /capabilities: chat_completions=PASS, streaming=PASS, multi_turn_tool_messages=PASS, strict_schema=WARN/);
  assert.match(result.stdout, /attention:/);
  assert.match(result.stdout, /strict_schema: WARN/);
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  assert.equal(report.summary.status, "WARN");
  assert.equal(report.summary.warned, 1);
  assert.equal(report.summary.capabilities.strict_schema, "WARN");
  const strictSchemaCheck = report.checks.find((check) => check.name === "strict_schema_request");
  assert.match(strictSchemaCheck.notes.join("\n"), /did not include tool_calls/);

  const strictResult = await runNode([
    bin,
    "probe",
    "--endpoint",
    upstreamUrl,
    "--model",
    "mock-model",
    "--out",
    path.join(dir, "strict-capability-report.json"),
    "--fail-on-warn",
  ]);

  assert.equal(strictResult.status, 1);
});

test("probe compares against a baseline report and can fail on regression", async (t) => {
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
  const baselinePath = path.join(dir, "baseline.json");
  const reportPath = path.join(dir, "current.json");
  const markdownPath = path.join(dir, "current.md");
  fs.writeFileSync(baselinePath, `${JSON.stringify({
    generated_at: "2026-05-25T00:00:00.000Z",
    endpoint: "https://baseline.example.com/v1",
    summary: {
      capabilities: {
        strict_schema: "PASS",
      },
    },
  }, null, 2)}\n`);

  const result = await runNode([
    bin,
    "probe",
    "--endpoint",
    upstreamUrl,
    "--checks",
    "strict_schema",
    "--baseline",
    baselinePath,
    "--out",
    reportPath,
    "--markdown",
    markdownPath,
  ]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /probe summary: WARN \(0 passed, 1 warned, 0 failed\)/);
  assert.match(result.stdout, /baseline: REGRESSED \(1 regressions, 0 improvements\)/);
  assert.match(result.stdout, /attention:/);
  assert.match(result.stdout, /strict_schema: WARN/);
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  assert.equal(report.baseline.status, "REGRESSED");
  assert.deepEqual(report.baseline.regressions, [{
    capability: "strict_schema",
    previous: "PASS",
    current: "WARN",
  }]);

  const markdown = fs.readFileSync(markdownPath, "utf8");
  assert.match(markdown, /## Baseline Comparison/);
  assert.match(markdown, /Status: \*\*REGRESSED\*\*/);
  assert.match(markdown, /\| `strict_schema` \| PASS \| WARN \|/);

  const gated = await runNode([
    bin,
    "probe",
    "--endpoint",
    upstreamUrl,
    "--checks",
    "strict_schema",
    "--baseline",
    baselinePath,
    "--fail-on-regression",
    "--out",
    path.join(dir, "gated.json"),
  ]);

  assert.equal(gated.status, 1);
});

test("probe validates baseline reports before network checks", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dck-"));
  const missingPath = path.join(dir, "missing-baseline.json");
  const invalidPath = path.join(dir, "package.json");
  fs.writeFileSync(invalidPath, JSON.stringify({ name: "not-a-probe-report" }));

  const missing = spawnSync(process.execPath, [
    bin,
    "probe",
    "--endpoint",
    "http://127.0.0.1:1",
    "--baseline",
    missingPath,
  ], { encoding: "utf8" });

  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /probe baseline path does not exist/);
  assert.doesNotMatch(missing.stdout, /probe summary/);

  const invalid = spawnSync(process.execPath, [
    bin,
    "probe",
    "--endpoint",
    "http://127.0.0.1:1",
    "--baseline",
    invalidPath,
  ], { encoding: "utf8" });

  assert.equal(invalid.status, 2);
  assert.match(invalid.stderr, /probe baseline is not a probe report JSON/);
  assert.doesNotMatch(invalid.stdout, /probe summary/);
});

test("matrix summarizes multiple probe reports", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dck-"));
  const officialPath = path.join(dir, "official.json");
  const relayPath = path.join(dir, "relay.json");
  const matrixPath = path.join(dir, "matrix.json");
  const markdownPath = path.join(dir, "Provider_Matrix.md");
  const directoryMatrixPath = path.join(dir, "directory-matrix.json");

  fs.writeFileSync(officialPath, `${JSON.stringify({
    name: "Official DeepSeek",
    generated_at: "2026-05-26T00:00:00.000Z",
    endpoint: "https://api.deepseek.com",
    profile: "official",
    model: "deepseek-chat",
    checks_requested: ["agent"],
    summary: {
      status: "PASS",
      capabilities: {
        multi_turn_tool_messages: "PASS",
        strict_schema: "PASS",
      },
    },
  }, null, 2)}\n`);

  fs.writeFileSync(relayPath, `${JSON.stringify({
    generated_at: "2026-05-26T00:05:00.000Z",
    endpoint: "https://relay.example.com/v1",
    profile: "relay",
    model: "deepseek-chat",
    summary: {
      status: "WARN",
      capabilities: {
        chat_completions: "PASS",
        streaming: "WARN",
      },
    },
    baseline: {
      status: "REGRESSED",
    },
  }, null, 2)}\n`);

  fs.writeFileSync(path.join(dir, "notes.txt"), "not a probe report\n");

  const result = spawnSync(process.execPath, [
    bin,
    "matrix",
    officialPath,
    relayPath,
    "--out",
    matrixPath,
    "--markdown",
    markdownPath,
    "--fail-on-fail",
  ], { encoding: "utf8" });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /wrote provider matrix/);
  assert.match(result.stdout, /wrote markdown provider matrix/);

  const directoryResult = spawnSync(process.execPath, [
    bin,
    "matrix",
    dir,
    "--out",
    directoryMatrixPath,
  ], { encoding: "utf8" });
  assert.equal(directoryResult.status, 0);
  const directoryMatrix = JSON.parse(fs.readFileSync(directoryMatrixPath, "utf8"));
  assert.equal(directoryMatrix.summary.reports, 2);
  assert.deepEqual(directoryMatrix.reports.map((report) => path.basename(report.source)), ["official.json", "relay.json"]);

  const matrix = JSON.parse(fs.readFileSync(matrixPath, "utf8"));
  assert.equal(matrix.summary.reports, 2);
  assert.equal(matrix.summary.passed, 1);
  assert.equal(matrix.summary.warned, 1);
  assert.equal(matrix.summary.regressed, 1);
  assert.equal(matrix.summary.required_failures, 0);
  assert.equal(matrix.gate.fail_on_fail, true);
  assert.equal(matrix.gate.fail_on_warn, false);
  assert.equal(matrix.gate.fail_on_regression, false);
  assert.deepEqual(matrix.gate.required_capabilities, []);
  assert.equal(matrix.reports[0].name, "Official DeepSeek");
  assert.equal(matrix.reports[1].name, "relay.json");
  assert.equal(matrix.reports[0].capabilities.chat_completions, "MISSING");
  assert.equal(matrix.reports[1].baseline_status, "REGRESSED");

  const markdown = fs.readFileSync(markdownPath, "utf8");
  assert.match(markdown, /# DeepSeek CompatKit Provider Matrix/);
  assert.match(markdown, /Reports: 2/);
  assert.match(markdown, /Regressed: 1/);
  assert.match(markdown, /Required capability failures: 0/);
  assert.match(markdown, /Fail on fail: yes/);
  assert.match(markdown, /Required capabilities: none/);
  assert.match(markdown, /Official DeepSeek/);
  assert.match(markdown, /relay\.json/);
  assert.match(markdown, /relay\.example\.com/);
  assert.match(markdown, /REGRESSED/);

  const warnGate = spawnSync(process.execPath, [
    bin,
    "matrix",
    officialPath,
    relayPath,
    "--fail-on-warn",
  ], { encoding: "utf8" });
  assert.equal(warnGate.status, 1);

  const regressionGate = spawnSync(process.execPath, [
    bin,
    "matrix",
    officialPath,
    relayPath,
    "--fail-on-regression",
  ], { encoding: "utf8" });
  assert.equal(regressionGate.status, 1);

  const requirePassPath = path.join(dir, "require-pass.json");
  const requirePass = spawnSync(process.execPath, [
    bin,
    "matrix",
    officialPath,
    "--require",
    "agent",
    "--out",
    requirePassPath,
  ], { encoding: "utf8" });
  assert.equal(requirePass.status, 0);
  const requirePassMatrix = JSON.parse(fs.readFileSync(requirePassPath, "utf8"));
  assert.deepEqual(requirePassMatrix.gate.required_capabilities, ["multi_turn_tool_messages", "strict_schema"]);
  assert.equal(requirePassMatrix.summary.required_failures, 0);

  const requireGate = spawnSync(process.execPath, [
    bin,
    "matrix",
    officialPath,
    relayPath,
    "--require",
    "agent",
  ], { encoding: "utf8" });
  assert.equal(requireGate.status, 1);
  assert.match(requireGate.stdout, /Required Capability Failures/);
  assert.match(requireGate.stdout, /relay\.json/);
  assert.match(requireGate.stdout, /multi_turn_tool_messages/);
});

test("matrix reports missing input paths without throwing", () => {
  const missingPath = path.join(os.tmpdir(), `dck-missing-${Date.now()}.json`);
  const result = spawnSync(process.execPath, [
    bin,
    "matrix",
    missingPath,
  ], { encoding: "utf8" });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /matrix input path does not exist/);
  assert.match(result.stderr, /dck-missing-/);
  assert.doesNotMatch(result.stderr, /\[deepseek-compat-kit\]/);
});

test("matrix rejects direct non-probe JSON inputs", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dck-"));
  const notReportPath = path.join(dir, "package.json");
  fs.writeFileSync(notReportPath, JSON.stringify({
    name: "not-a-probe-report",
    dependencies: {},
  }));

  const result = spawnSync(process.execPath, [
    bin,
    "matrix",
    notReportPath,
  ], { encoding: "utf8" });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /matrix input is not a probe report JSON/);
  assert.match(result.stderr, /package\.json/);
  assert.doesNotMatch(result.stdout, /Capability Matrix/);
});

test("probe normalizes full chat completions endpoint URLs", async (t) => {
  const seenPaths = [];
  const mock = http.createServer((request, response) => {
    collectRequestJson(request).then((body) => {
      const pathname = new URL(request.url, "http://127.0.0.1").pathname;
      seenPaths.push(pathname);
      if (request.method !== "POST" || pathname !== "/v1/chat/completions") {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { message: "not found" } }));
        return;
      }

      if ((request.headers.accept || "").includes("text/event-stream")) {
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "ok" } }] })}\n\n`);
        response.write("data: [DONE]\n\n");
        response.end();
        return;
      }

      if (body.tool_choice?.function?.name === "record_query") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({
          choices: [{
            message: {
              role: "assistant",
              tool_calls: [{
                id: "call_probe_query",
                type: "function",
                function: {
                  name: "record_query",
                  arguments: "{\"query\":\"compatibility\"}",
                },
              }],
            },
          }],
        }));
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
    `${upstreamUrl}/v1/chat/completions?debug=true#fragment`,
    "--model",
    "mock-model",
    "--out",
    reportPath,
    "--markdown",
    markdownPath,
  ]);

  assert.equal(result.status, 0);
  assert.deepEqual([...new Set(seenPaths)], ["/v1/chat/completions"]);

  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  assert.equal(report.endpoint_input, `${upstreamUrl}/v1/chat/completions?debug=true#fragment`);
  assert.equal(report.endpoint, `${upstreamUrl}/v1`);
  assert.deepEqual(report.endpoint_diagnostics.map((item) => item.code), [
    "DSK_PROBE_ENDPOINT_STRIPPED_SUFFIX",
    "DSK_PROBE_ENDPOINT_CHAT_COMPLETIONS",
  ]);

  const markdown = fs.readFileSync(markdownPath, "utf8");
  assert.match(markdown, /## Endpoint Diagnostics/);
  assert.match(markdown, /DSK_PROBE_ENDPOINT_CHAT_COMPLETIONS/);
});

test("probe times out slow endpoints and validates timeout arguments", async (t) => {
  const mock = http.createServer((_request, _response) => {
    // Keep the request open longer than the probe timeout.
  });

  const upstreamUrl = await listen(mock);
  t.after(() => mock.close());

  const invalid = await runNode([
    bin,
    "probe",
    "--endpoint",
    upstreamUrl,
    "--timeout-ms",
    "0",
  ]);
  assert.equal(invalid.status, 2);
  assert.match(invalid.stderr, /positive integer/);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dck-"));
  const reportPath = path.join(dir, "timeout-report.json");
  const result = await runNode([
    bin,
    "probe",
    "--endpoint",
    upstreamUrl,
    "--timeout-ms",
    "25",
    "--out",
    reportPath,
  ]);

  assert.equal(result.status, 1);
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  assert.equal(report.timeout_ms, 25);
  assert.equal(report.summary.status, "FAIL");
  assert.equal(report.checks[0].status, "FAIL");
  assert.match(report.checks[0].notes.join("\n"), /Timed out after 25 ms/);
});

test("probe reads API key from explicit env without leaking it", async (t) => {
  const authorizations = [];
  const mock = http.createServer((request, response) => {
    collectRequestJson(request).then((body) => {
      authorizations.push(request.headers.authorization || "");
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

      if (body.tool_choice?.function?.name === "record_query") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({
          choices: [{
            message: {
              role: "assistant",
              tool_calls: [{
                id: "call_probe_query",
                type: "function",
                function: {
                  name: "record_query",
                  arguments: "{\"query\":\"compatibility\"}",
                },
              }],
            },
          }],
        }));
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
  const reportPath = path.join(dir, "auth-report.json");
  const secret = "sk-probe-secret-should-not-leak";
  const result = await runNode([
    bin,
    "probe",
    "--endpoint",
    upstreamUrl,
    "--api-key-env",
    "DCK_TEST_API_KEY",
    "--out",
    reportPath,
  ], {
    env: { DCK_TEST_API_KEY: secret },
  });

  assert.equal(result.status, 0);
  assert.ok(authorizations.length > 0);
  assert.ok(authorizations.every((header) => header === `Bearer ${secret}`));

  const reportText = fs.readFileSync(reportPath, "utf8");
  const report = JSON.parse(reportText);
  assert.deepEqual(report.auth, {
    api_key_env: "DCK_TEST_API_KEY",
    api_key_present: true,
  });
  assert.doesNotMatch(reportText, new RegExp(secret));
  assert.doesNotMatch(result.stdout, new RegExp(secret));
});

test("probe redacts secrets from upstream error bodies", async (t) => {
  const secretKey = "sk-upstreamsecretvalue1234567890";
  const bearer = "Bearer upstreambearersecret1234567890";
  const email = "owner@example.com";
  const url = `https://relay.example.com/v1/chat/completions?access_token=upstream-token-secret`;
  const mock = http.createServer((request, response) => {
    collectRequestJson(request).then(() => {
      const pathname = new URL(request.url, "http://127.0.0.1").pathname;
      if (request.method !== "POST" || pathname !== "/chat/completions") {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { message: "not found" } }));
        return;
      }

      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({
        error: {
          message: `bad request for ${email}`,
          authorization: bearer,
          api_key: secretKey,
          callback: url,
        },
      }));
    }).catch((error) => {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: error.message }));
    });
  });

  const upstreamUrl = await listen(mock);
  t.after(() => mock.close());

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dck-"));
  const reportPath = path.join(dir, "redacted-error-report.json");
  const result = await runNode([
    bin,
    "probe",
    "--endpoint",
    upstreamUrl,
    "--checks",
    "chat",
    "--out",
    reportPath,
  ]);

  assert.equal(result.status, 0);
  const reportText = fs.readFileSync(reportPath, "utf8");
  assert.doesNotMatch(reportText, new RegExp(secretKey));
  assert.doesNotMatch(reportText, /upstreambearersecret/);
  assert.doesNotMatch(reportText, new RegExp(email));
  assert.doesNotMatch(reportText, /upstream-token-secret/);
  assert.match(reportText, /sk-<redacted>/);
  assert.match(reportText, /Bearer <redacted>/);
  assert.match(reportText, /<redacted:email>/);
  assert.match(reportText, /access_token=<redacted>/);
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

test("probe rejects unknown selected checks before network calls", async () => {
  const result = await runNode([
    bin,
    "probe",
    "--endpoint",
    "http://127.0.0.1:1",
    "--checks",
    "strict_schema,unknown",
  ]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Unknown probe check/);
  assert.match(result.stderr, /strict_schema/);
});

test("probe rejects malformed extra headers before network calls", async () => {
  const result = await runNode([
    bin,
    "probe",
    "--endpoint",
    "http://127.0.0.1:1",
    "--header",
    "not-a-header",
  ]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /--header must use the form/);
});

test("probe rejects missing header env values before network calls", async () => {
  const result = await runNode([
    bin,
    "probe",
    "--endpoint",
    "http://127.0.0.1:1",
    "--header-env",
    "X-Relay-Token=DSCK_MISSING_RELAY_TOKEN",
  ], { env: { DSCK_MISSING_RELAY_TOKEN: "" } });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /DSCK_MISSING_RELAY_TOKEN is not set/);
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
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({
    dependencies: {
      openai: "^4.0.0",
      "@langchain/openai": "^0.6.0",
    },
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
  assert.deepEqual(report.summary.detected_targets, ["langchain-js", "openai-js"]);
  assert.match(reportText, /DSK_REC_DOCTOR_TARGET/);
  assert.match(reportText, /doctor --target openai-js/);
  assert.match(reportText, /doctor --target langchain-js/);
  assert.match(markdown, /# DeepSeek CompatKit Inventory Report/);
  assert.match(markdown, /Detected targets: `langchain-js`, `openai-js`/);
  assert.match(markdown, /## Recommendations/);
  assert.match(markdown, /doctor --target openai-js/);
});

test("inventory reports when the scan file limit is reached", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dck-"));
  const reportPath = path.join(dir, "reports", "inventory.json");
  const markdownPath = path.join(dir, "reports", "inventory.md");
  for (let index = 0; index < 505; index += 1) {
    fs.writeFileSync(path.join(dir, `config-${String(index).padStart(3, "0")}.json`), JSON.stringify({ name: `file-${index}` }));
  }

  const result = spawnSync(process.execPath, [
    bin,
    "inventory",
    `--path=${dir}`,
    "--max-files=3",
    `--out=${reportPath}`,
    `--markdown=${markdownPath}`,
  ], { encoding: "utf8" });

  assert.equal(result.status, 0);
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  assert.equal(report.summary.files_scanned, 3);
  assert.equal(report.summary.max_files, 3);
  assert.equal(report.summary.scan_limit_reached, true);
  assert.ok(report.findings.some((finding) => finding.code === "DSK_INV_SCAN_LIMIT"));
  assert.ok(report.recommendations.some((recommendation) => recommendation.code === "DSK_REC_NARROW_INVENTORY_PATH"));
  assert.ok(!report.recommendations.some((recommendation) => recommendation.code === "DSK_REC_REDACT_SECRETS"));

  const markdown = fs.readFileSync(markdownPath, "utf8");
  assert.match(markdown, /Scan limit: reached \(3 files\)/);
  assert.match(markdown, /DSK_INV_SCAN_LIMIT/);
  assert.match(markdown, /re-run against a narrower path/i);

  const invalid = spawnSync(process.execPath, [
    bin,
    "inventory",
    `--path=${dir}`,
    "--max-files=0",
  ], { encoding: "utf8" });
  assert.equal(invalid.status, 2);
  assert.match(invalid.stderr, /--max-files must be a positive integer/);
});

test("inventory positional path ignores preceding output option values", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dck-"));
  const reportPath = path.join(dir, "reports", "inventory.json");
  fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({
    model: "deepseek-chat",
  }));

  const result = spawnSync(process.execPath, [
    bin,
    "inventory",
    "--out",
    reportPath,
    dir,
  ], { encoding: "utf8" });

  assert.equal(result.status, 0);
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  assert.equal(report.root, dir);
  assert.equal(report.summary.models, 1);
});

test("recipes lists and prints the OpenCode recipe", () => {
  const list = spawnSync(process.execPath, [bin, "recipes"], { encoding: "utf8" });
  assert.equal(list.status, 0);
  assert.match(list.stdout, /opencode/);
  assert.match(list.stdout, /cline/);
  assert.match(list.stdout, /roo-code/);
  assert.match(list.stdout, /openrouter/);
  assert.match(list.stdout, /openai-js/);
  assert.match(list.stdout, /langchain-js/);

  const recipe = spawnSync(process.execPath, [bin, "recipes", "opencode"], { encoding: "utf8" });
  assert.equal(recipe.status, 0);
  assert.match(recipe.stdout, /OpenCode \+ DeepSeek CompatKit Recipe/);
  assert.match(recipe.stdout, /http:\/\/127\.0\.0\.1:8787\/v1/);
  assert.match(recipe.stdout, /compile-schema/);
  assert.match(recipe.stdout, /does not edit OpenCode configuration files/);
});

test("recipes and doctor support OpenRouter relay adoption", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dck-"));
  const inventoryPath = path.join(dir, "reports", "openrouter-inventory.json");
  fs.writeFileSync(path.join(dir, ".env"), [
    "OPENROUTER_API_KEY=or-secret-value-1234567890",
    "RELAY_TOKEN=relay-secret-value-1234567890",
    "NEXT_PUBLIC_API_KEY=public-browser-value",
  ].join("\n"));
  fs.writeFileSync(path.join(dir, "openrouter-config.json"), JSON.stringify({
    baseURL: "https://openrouter.ai/api/v1",
    model: "deepseek/deepseek-chat",
  }, null, 2));

  const inventoryResult = spawnSync(process.execPath, [
    bin,
    "inventory",
    "--path",
    dir,
    "--out",
    inventoryPath,
  ], { encoding: "utf8" });
  assert.equal(inventoryResult.status, 0);

  const inventoryReport = JSON.parse(fs.readFileSync(inventoryPath, "utf8"));
  assert.equal(inventoryReport.summary.base_urls, 1);
  assert.equal(inventoryReport.summary.warnings, 2);
  assert.deepEqual(inventoryReport.summary.detected_targets, ["openrouter"]);
  assert.match(JSON.stringify(inventoryReport.findings), /OPENROUTER_API_KEY/);
  assert.match(JSON.stringify(inventoryReport.findings), /RELAY_TOKEN/);
  assert.doesNotMatch(JSON.stringify(inventoryReport.findings), /NEXT_PUBLIC_API_KEY/);
  assert.doesNotMatch(JSON.stringify(inventoryReport), /or-secret-value/);
  assert.doesNotMatch(JSON.stringify(inventoryReport), /relay-secret-value/);
  assert.doesNotMatch(JSON.stringify(inventoryReport), /public-browser-value/);
  assert.match(JSON.stringify(inventoryReport.recommendations), /probe --endpoint <base-url>/);

  const recipe = spawnSync(process.execPath, [bin, "recipes", "openrouter"], { encoding: "utf8" });
  assert.equal(recipe.status, 0);
  assert.match(recipe.stdout, /OpenRouter \+ DeepSeek CompatKit Recipe/);
  assert.match(recipe.stdout, /https:\/\/openrouter\.ai\/api\/v1/);
  assert.match(recipe.stdout, /--header-env "HTTP-Referer=OPENROUTER_APP_URL"/);
  assert.match(recipe.stdout, /--upstream-api-key-env OPENROUTER_API_KEY/);
  assert.match(recipe.stdout, /matrix \.\/reports --require agent/);

  const doctor = spawnSync(process.execPath, [bin, "doctor", "--target", "openrouter", "--print"], { encoding: "utf8" });
  assert.equal(doctor.status, 0);
  assert.match(doctor.stdout, /DeepSeek CompatKit Doctor: OpenRouter/);
  assert.match(doctor.stdout, /OpenRouter \+ DeepSeek CompatKit Recipe/);
  assert.match(doctor.stdout, /does not edit OpenRouter/);
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

test("doctor positional target ignores short path option values", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dck-"));
  const result = spawnSync(process.execPath, [
    bin,
    "doctor",
    "-p",
    dir,
    "opencode",
    "--print",
  ], { encoding: "utf8" });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /DeepSeek CompatKit Doctor: OpenCode/);
  assert.doesNotMatch(result.stderr, /Unknown doctor target/);
});

test("doctor auto combines detected target recipes from inventory", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dck-"));
  const doctorPath = path.join(dir, "DeepSeek_Doctor.md");
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({
    dependencies: {
      openai: "^4.0.0",
      "@langchain/openai": "^0.6.0",
    },
  }, null, 2));
  fs.writeFileSync(path.join(dir, "agent.ts"), [
    "import OpenAI from 'openai';",
    "import { ChatOpenAI } from '@langchain/openai';",
    "const baseURL = 'http://127.0.0.1:8787/v1';",
    "const model = 'deepseek-chat';",
  ].join("\n"));

  const result = spawnSync(process.execPath, [
    bin,
    "doctor",
    "--target",
    "auto",
    "--path",
    dir,
    "--max-files",
    "3",
    "--markdown",
    doctorPath,
  ], { encoding: "utf8" });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /wrote doctor report/);

  const report = fs.readFileSync(doctorPath, "utf8");
  assert.match(report, /# DeepSeek CompatKit Doctor: Auto/);
  assert.match(report, /Scan limit: not reached \(3 files\)/);
  assert.match(report, /Detected targets: `langchain-js`, `openai-js`/);
  assert.match(report, /## Target Recipes/);
  assert.match(report, /OpenAI JS SDK \+ DeepSeek CompatKit Recipe/);
  assert.match(report, /LangChain JS \+ DeepSeek CompatKit Recipe/);
  assert.match(report, /No configuration files were modified/);
});

test("doctor auto requires an explicit local path", () => {
  const result = spawnSync(process.execPath, [bin, "doctor", "--target", "auto"], { encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /doctor --target auto --path/);
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
  assert.match(report, /Detected targets: `opencode`/);
  assert.match(report, /### Inventory Recommendations/);
  assert.match(report, /doctor --target opencode/);
  assert.match(report, /deepseek-chat/);
  assert.match(report, /## Target Recipe/);
  assert.match(report, /OpenCode \+ DeepSeek CompatKit Recipe/);
  assert.doesNotMatch(report, /doctorsecretvalue/);
});

test("diagnose detects dropped reasoning_content", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dck-"));
  const reportPath = path.join(dir, "reports", "json", "diagnose-report.json");
  const markdownPath = path.join(dir, "reports", "md", "Diagnose_Report.md");
  const result = spawnSync(process.execPath, [
    bin,
    "diagnose",
    "fixtures/tool-calls/reasoning-content-lost.jsonl",
    "--out",
    reportPath,
    "--markdown",
    markdownPath,
  ], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /DSK_REASONING_001/);
  assert.match(result.stdout, /wrote diagnose JSON report/);
  assert.match(result.stdout, /wrote diagnose markdown report/);

  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  assert.equal(report.report_type, "diagnose");
  assert.equal(report.summary.status, "FAIL");
  assert.equal(report.summary.events, 3);
  assert.equal(report.summary.findings, 1);
  assert.equal(report.findings[0].code, "DSK_REASONING_001");
  assert.ok(report.next_steps.some((step) => step.includes("Preserve `reasoning_content`")));

  const markdown = fs.readFileSync(markdownPath, "utf8");
  assert.match(markdown, /# DeepSeek CompatKit Diagnose Report/);
  assert.match(markdown, /Status: FAIL/);
  assert.match(markdown, /Events: 3/);
  assert.match(markdown, /DSK_REASONING_001/);
  assert.match(markdown, /Preserve `reasoning_content`/);
});

test("diagnose can fail CI on warning-level findings", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dck-"));
  const input = path.join(dir, "proxy.jsonl");
  const reportPath = path.join(dir, "diagnose-report.json");
  const markdownPath = path.join(dir, "Diagnose_Report.md");
  fs.writeFileSync(input, `${JSON.stringify({
    type: "request",
    messages: [{ role: "user", content_summary: "redacted:user" }],
    repair: {
      findings: [{
        level: "WARN",
        code: "DSK_REASONING_002",
        path: "messages[1].tool_calls",
        message: "Cannot restore reasoning_content because only part of the assistant tool-call set was seen.",
      }],
    },
  })}\n`);

  const relaxed = spawnSync(process.execPath, [
    bin,
    "diagnose",
    input,
    "--out",
    reportPath,
    "--markdown",
    markdownPath,
  ], { encoding: "utf8" });
  assert.equal(relaxed.status, 0);
  assert.match(relaxed.stdout, /WARN DSK_REASONING_002/);

  const relaxedReport = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  assert.equal(relaxedReport.summary.status, "WARN");
  assert.equal(relaxedReport.gate.fail_on_warn, false);
  assert.equal(relaxedReport.gate.failed, false);

  const strict = spawnSync(process.execPath, [
    bin,
    "diagnose",
    input,
    "--out",
    reportPath,
    "--markdown",
    markdownPath,
    "--fail-on-warn",
  ], { encoding: "utf8" });
  assert.equal(strict.status, 1);
  assert.match(strict.stdout, /WARN DSK_REASONING_002/);

  const strictReport = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  assert.equal(strictReport.summary.status, "WARN");
  assert.equal(strictReport.gate.fail_on_warn, true);
  assert.equal(strictReport.gate.failed, true);

  const markdown = fs.readFileSync(markdownPath, "utf8");
  assert.match(markdown, /Fail on warn: yes/);
  assert.match(markdown, /Gate failed: yes/);
});

test("diagnose reports original JSONL line numbers for malformed logs", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dck-"));
  const input = path.join(dir, "bad.jsonl");
  fs.writeFileSync(input, [
    "",
    JSON.stringify({ type: "request", messages: [] }),
    "{bad json",
    "",
  ].join("\n"));

  const result = spawnSync(process.execPath, [
    bin,
    "diagnose",
    input,
  ], { encoding: "utf8" });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Failed to parse JSONL line 3/);
  assert.match(result.stderr, /bad\.jsonl/);
});

test("diagnose positional input ignores preceding output option values", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dck-"));
  const input = path.join(dir, "run.jsonl");
  const reportPath = path.join(dir, "reports", "diagnose.json");
  fs.writeFileSync(input, `${JSON.stringify({ type: "request", messages: [] })}\n`);

  const result = spawnSync(process.execPath, [
    bin,
    "diagnose",
    "--out",
    reportPath,
    input,
  ], { encoding: "utf8" });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /wrote diagnose JSON report/);
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  assert.equal(report.source, input);
});

test("sanitize redacts reasoning_content and tool results", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dck-"));
  const input = path.join(dir, "run.jsonl");
  const output = path.join(dir, "safe", "fixtures", "safe.jsonl");
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

test("sanitize positional input ignores preceding output option values", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dck-"));
  const input = path.join(dir, "run.jsonl");
  const output = path.join(dir, "safe", "safe.jsonl");
  fs.writeFileSync(input, `${JSON.stringify({
    type: "response",
    message: { role: "assistant", reasoning_content: "private thoughts" },
  })}\n`);

  const result = spawnSync(process.execPath, [
    bin,
    "sanitize",
    "--out",
    output,
    input,
  ], { encoding: "utf8" });

  assert.equal(result.status, 0);
  assert.match(fs.readFileSync(output, "utf8"), /redacted:reasoning_content/);
});

test("proxy validates upstream header options before listening", () => {
  const result = spawnSync(process.execPath, [
    bin,
    "proxy",
    "--port",
    "0",
    "--upstream-header",
    "not-a-header",
  ], { encoding: "utf8" });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /--upstream-header must use the form/);
});

test("CLI accepts inline --flag=value arguments", async (t) => {
  const server = http.createServer((request, response) => {
    assert.equal(request.headers["x-relay-token"], "relay-value");
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      id: "chatcmpl_inline_args",
      object: "chat.completion",
      choices: [{
        index: 0,
        message: { role: "assistant", content: "ok" },
        finish_reason: "stop",
      }],
    }));
  });
  const upstreamUrl = await listen(server);
  t.after(() => server.close());

  const result = await runNode([
    bin,
    "probe",
    `--endpoint=${upstreamUrl}`,
    "--model=deepseek-chat",
    "--checks=chat_completions",
    "--header-env=X-Relay-Token=DSCK_INLINE_RELAY_TOKEN",
  ], {
    encoding: "utf8",
    env: { DSCK_INLINE_RELAY_TOKEN: "relay-value" },
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /"status": "PASS"/);
});

test("proxy validates upstream timeout before listening", () => {
  const result = spawnSync(process.execPath, [
    bin,
    "proxy",
    "--port",
    "0",
    "--upstream-timeout-ms",
    "0",
  ], { encoding: "utf8" });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /--upstream-timeout-ms must be a positive integer/);
});

test("proxy validates reasoning state TTL before listening", () => {
  const result = spawnSync(process.execPath, [
    bin,
    "proxy",
    "--port",
    "0",
    "--state-ttl-ms",
    "0",
  ], { encoding: "utf8" });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /--state-ttl-ms must be a positive integer/);
});

test("proxy returns 502 when upstream response times out", async (t) => {
  const upstream = http.createServer((_request, _response) => {
    // Leave the response open until the proxy's upstream response timeout fires.
  });

  const upstreamUrl = await listen(upstream);
  const proxyPort = await freePort();
  const proxy = spawn(process.execPath, [
    bin,
    "proxy",
    "--port",
    String(proxyPort),
    "--upstream",
    upstreamUrl,
    "--upstream-timeout-ms",
    "50",
  ], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  t.after(() => {
    proxy.kill();
    upstream.close();
  });

  await waitForOutput(proxy.stderr, /proxy listening/);

  const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "deepseek-reasoner", messages: [{ role: "user", content: "hello" }] }),
  });

  assert.equal(response.status, 502);
  const payload = await response.json();
  assert.match(payload.error.detail, /upstream did not respond within 50 ms/);
});

test("proxy health reports runtime state without leaking secrets", async (t) => {
  const upstream = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok" } }] }));
  });

  const upstreamUrl = await listen(upstream);
  const proxyPort = await freePort();
  const secret = "proxy-health-secret-should-not-leak";
  const proxy = spawn(process.execPath, [
    bin,
    "proxy",
    "--port",
    String(proxyPort),
    "--upstream",
    upstreamUrl,
    "--upstream-api-key-env",
    "DSCK_PROXY_HEALTH_KEY",
    "--upstream-timeout-ms",
    "1234",
    "--state-ttl-ms",
    "5678",
    "--upstream-header",
    "HTTP-Referer: https://example.com/deepseek-compat-kit",
    "--upstream-header-env",
    "X-Relay-Token=DSCK_PROXY_HEALTH_RELAY_TOKEN",
  ], {
    env: {
      ...process.env,
      DSCK_PROXY_HEALTH_KEY: secret,
      DSCK_PROXY_HEALTH_RELAY_TOKEN: "relay-token-should-not-leak",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  t.after(() => {
    proxy.kill();
    upstream.close();
  });

  await waitForOutput(proxy.stderr, /proxy listening/);

  const response = await fetch(`http://127.0.0.1:${proxyPort}/health`);
  assert.equal(response.status, 200);
  const text = await response.text();
  const payload = JSON.parse(text);

  assert.equal(payload.ok, true);
  assert.equal(payload.mode, "proxy-alpha");
  assert.equal(payload.upstream, upstreamUrl);
  assert.equal(payload.upstream_api_key_env, "DSCK_PROXY_HEALTH_KEY");
  assert.equal(payload.upstream_api_key_present, true);
  assert.equal(payload.upstream_response_timeout_ms, 1234);
  assert.deepEqual(payload.upstream_extra_header_names.sort(), ["http-referer", "x-relay-token"].sort());
  assert.deepEqual(payload.reasoning_state, {
    cache_entries: 0,
    max_entries: 2000,
    ttl_ms: 5678,
  });
  assert.doesNotMatch(text, new RegExp(secret));
  assert.doesNotMatch(text, /relay-token-should-not-leak/);
});

test("proxy injects cached reasoning_content before forwarding follow-up tool calls", async (t) => {
  const upstreamRequests = [];
  const upstreamHeaders = [];
  const upstream = http.createServer((request, response) => {
    collectRequestJson(request).then((body) => {
      upstreamRequests.push(body);
      upstreamHeaders.push(request.headers);
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
  const proxy = spawn(process.execPath, [
    bin,
    "proxy",
    "--port",
    String(proxyPort),
    "--upstream",
    upstreamUrl,
    "--upstream-header",
    "HTTP-Referer: https://example.com/deepseek-compat-kit",
    "--upstream-header-env",
    "X-Relay-Token=DSCK_PROXY_RELAY_TOKEN",
  ], {
    env: { ...process.env, DSCK_PROXY_RELAY_TOKEN: "proxy-relay-token-should-not-leak" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  t.after(() => {
    proxy.kill();
    upstream.close();
  });

  await waitForOutput(proxy.stderr, /proxy listening/);

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
  assert.ok(upstreamHeaders.every((headers) => headers["http-referer"] === "https://example.com/deepseek-compat-kit"));
  assert.ok(upstreamHeaders.every((headers) => headers["x-relay-token"] === "proxy-relay-token-should-not-leak"));
});

test("proxy deduplicates shared reasoning_content across multiple tool calls", async (t) => {
  const upstreamRequests = [];
  const upstreamHeaders = [];
  const upstream = http.createServer((request, response) => {
    collectRequestJson(request).then((body) => {
      upstreamRequests.push(body);
      upstreamHeaders.push(request.headers);
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
  const proxy = spawn(process.execPath, [
    bin,
    "proxy",
    "--port",
    String(proxyPort),
    "--upstream",
    upstreamUrl,
    "--upstream-api-key-env",
    "DSCK_PROXY_UPSTREAM_API_KEY",
  ], {
    env: { ...process.env, DSCK_PROXY_UPSTREAM_API_KEY: "proxy-upstream-api-key-should-not-leak" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  t.after(() => {
    proxy.kill();
    upstream.close();
  });

  await waitForOutput(proxy.stderr, /proxy listening/);

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
  assert.ok(upstreamHeaders.every((headers) => headers.authorization === "Bearer proxy-upstream-api-key-should-not-leak"));
});

test("proxy refuses partial reasoning_content restoration when a tool call is missing from cache", async (t) => {
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
              reasoning_content: "only one cached reasoning",
              tool_calls: [
                { id: "call_known", type: "function", function: { name: "known", arguments: "{}" } },
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
  const proxy = spawn(process.execPath, [
    bin,
    "proxy",
    "--port",
    String(proxyPort),
    "--upstream",
    upstreamUrl,
  ], { stdio: ["ignore", "pipe", "pipe"] });

  t.after(() => {
    proxy.kill();
    upstream.close();
  });

  await waitForOutput(proxy.stderr, /proxy listening/);
  const proxyUrl = `http://127.0.0.1:${proxyPort}/v1/chat/completions`;

  await fetch(proxyUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "deepseek-reasoner", messages: [{ role: "user", content: "first" }] }),
  });

  const warning = waitForOutput(proxy.stderr, /DSK_REASONING_002/);
  const second = await fetch(proxyUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "deepseek-reasoner",
      messages: [{
        role: "assistant",
        tool_calls: [
          { id: "call_known", type: "function", function: { name: "known", arguments: "{}" } },
          { id: "call_missing", type: "function", function: { name: "missing", arguments: "{}" } },
        ],
      }],
    }),
  });
  await warning;
  assert.equal(second.status, 200);
  assert.equal(second.headers.get("x-deepseek-compat-reasoning-injected"), "0");
  await second.json();

  assert.equal(upstreamRequests.length, 2);
  assert.equal(upstreamRequests[1].messages[0].reasoning_content, undefined);
});

test("proxy refuses to combine cached reasoning_content from multiple assistant turns", async (t) => {
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
              reasoning_content: "first turn reasoning",
              tool_calls: [
                { id: "call_first", type: "function", function: { name: "first", arguments: "{}" } },
              ],
            },
          }],
        }));
        return;
      }

      if (upstreamRequests.length === 2) {
        response.end(JSON.stringify({
          choices: [{
            message: {
              role: "assistant",
              reasoning_content: "second turn reasoning",
              tool_calls: [
                { id: "call_second", type: "function", function: { name: "second", arguments: "{}" } },
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
  const proxy = spawn(process.execPath, [
    bin,
    "proxy",
    "--port",
    String(proxyPort),
    "--upstream",
    upstreamUrl,
  ], { stdio: ["ignore", "pipe", "pipe"] });

  t.after(() => {
    proxy.kill();
    upstream.close();
  });

  await waitForOutput(proxy.stderr, /proxy listening/);
  const proxyUrl = `http://127.0.0.1:${proxyPort}/v1/chat/completions`;

  await fetch(proxyUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "deepseek-reasoner", messages: [{ role: "user", content: "first" }] }),
  });

  await fetch(proxyUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "deepseek-reasoner", messages: [{ role: "user", content: "second" }] }),
  });

  const warning = waitForOutput(proxy.stderr, /DSK_REASONING_004/);
  const third = await fetch(proxyUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "deepseek-reasoner",
      messages: [{
        role: "assistant",
        tool_calls: [
          { id: "call_first", type: "function", function: { name: "first", arguments: "{}" } },
          { id: "call_second", type: "function", function: { name: "second", arguments: "{}" } },
        ],
      }],
    }),
  });
  await warning;
  assert.equal(third.status, 200);
  assert.equal(third.headers.get("x-deepseek-compat-reasoning-injected"), "0");
  await third.json();

  assert.equal(upstreamRequests.length, 3);
  assert.equal(upstreamRequests[2].messages[0].reasoning_content, undefined);
});

test("proxy expires cached reasoning_content after the configured state TTL", async (t) => {
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
              reasoning_content: "short lived reasoning",
              tool_calls: [
                { id: "call_ttl", type: "function", function: { name: "ttl", arguments: "{}" } },
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
  const proxy = spawn(process.execPath, [
    bin,
    "proxy",
    "--port",
    String(proxyPort),
    "--upstream",
    upstreamUrl,
    "--state-ttl-ms",
    "25",
  ], { stdio: ["ignore", "pipe", "pipe"] });

  t.after(() => {
    proxy.kill();
    upstream.close();
  });

  await waitForOutput(proxy.stderr, /reasoning state ttl: 25 ms/);
  const proxyUrl = `http://127.0.0.1:${proxyPort}/v1/chat/completions`;

  await fetch(proxyUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "deepseek-reasoner", messages: [{ role: "user", content: "first" }] }),
  });

  await delay(50);

  const warning = waitForOutput(proxy.stderr, /DSK_REASONING_002/);
  const second = await fetch(proxyUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "deepseek-reasoner",
      messages: [{
        role: "assistant",
        tool_calls: [
          { id: "call_ttl", type: "function", function: { name: "ttl", arguments: "{}" } },
        ],
      }],
    }),
  });
  await warning;
  assert.equal(second.status, 200);
  assert.equal(second.headers.get("x-deepseek-compat-reasoning-injected"), "0");
  await second.json();

  assert.equal(upstreamRequests.length, 2);
  assert.equal(upstreamRequests[1].messages[0].reasoning_content, undefined);
});

test("proxy writes sanitized diagnostics JSONL that diagnose can consume", async (t) => {
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
              reasoning_content: "private diagnostic reasoning should not be written",
              tool_calls: [
                { id: "call_diag", type: "function", function: { name: "diag_lookup", arguments: "{\"secret\":\"tool argument\"}" } },
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dck-"));
  const diagnosticsLog = path.join(dir, "proxy-diagnostics.jsonl");
  const secret = "proxy-diagnostics-secret-should-not-leak";
  const proxy = spawn(process.execPath, [
    bin,
    "proxy",
    "--port",
    String(proxyPort),
    "--upstream",
    upstreamUrl,
    "--upstream-api-key-env",
    "DSCK_PROXY_DIAG_KEY",
    "--state-ttl-ms",
    "25",
    "--diagnostics-log",
    diagnosticsLog,
  ], {
    env: { ...process.env, DSCK_PROXY_DIAG_KEY: secret },
    stdio: ["ignore", "pipe", "pipe"],
  });

  t.after(() => {
    proxy.kill();
    upstream.close();
  });

  await waitForOutput(proxy.stderr, /diagnostics log:/);
  const proxyUrl = `http://127.0.0.1:${proxyPort}/v1/chat/completions`;

  await fetch(proxyUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "deepseek-reasoner", messages: [{ role: "user", content: "private user prompt should not be written" }] }),
  });

  await delay(50);

  await fetch(proxyUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "deepseek-reasoner",
      messages: [{
        role: "assistant",
        tool_calls: [
          { id: "call_diag", type: "function", function: { name: "diag_lookup", arguments: "{\"secret\":\"request argument\"}" } },
        ],
      }],
    }),
  });

  const logText = fs.readFileSync(diagnosticsLog, "utf8");
  assert.match(logText, /"type":"request"/);
  assert.match(logText, /"type":"response"/);
  assert.match(logText, /redacted:reasoning_content/);
  assert.match(logText, /call_diag/);
  assert.match(logText, /DSK_REASONING_002/);
  assert.doesNotMatch(logText, /private diagnostic reasoning/);
  assert.doesNotMatch(logText, /private user prompt/);
  assert.doesNotMatch(logText, /tool argument/);
  assert.doesNotMatch(logText, /request argument/);
  assert.doesNotMatch(logText, new RegExp(secret));

  const reportPath = path.join(dir, "proxy-diagnose-report.json");
  const markdownPath = path.join(dir, "Proxy_Diagnose_Report.md");
  const diagnosis = spawnSync(process.execPath, [
    bin,
    "diagnose",
    diagnosticsLog,
    "--out",
    reportPath,
    "--markdown",
    markdownPath,
  ], { encoding: "utf8" });
  assert.equal(diagnosis.status, 1);
  assert.match(diagnosis.stdout, /DSK_REASONING_001/);
  assert.match(diagnosis.stdout, /DSK_REASONING_002/);

  const reportText = fs.readFileSync(reportPath, "utf8");
  const report = JSON.parse(reportText);
  assert.equal(report.summary.status, "FAIL");
  assert.equal(report.summary.findings, 2);
  assert.deepEqual(report.findings.map((finding) => finding.code).sort(), ["DSK_REASONING_001", "DSK_REASONING_002"].sort());
  assert.match(report.findings.find((finding) => finding.code === "DSK_REASONING_002").path, /repair\.findings/);
  assert.doesNotMatch(reportText, /private diagnostic reasoning/);
  assert.doesNotMatch(reportText, /private user prompt/);
  assert.doesNotMatch(reportText, new RegExp(secret));

  const markdown = fs.readFileSync(markdownPath, "utf8");
  assert.match(markdown, /# DeepSeek CompatKit Diagnose Report/);
  assert.match(markdown, /DSK_REASONING_001/);
  assert.match(markdown, /DSK_REASONING_002/);
  assert.match(markdown, /Assistant messages with reasoning_content/);
  assert.doesNotMatch(markdown, /private diagnostic reasoning/);
  assert.doesNotMatch(markdown, /private user prompt/);
  assert.doesNotMatch(markdown, new RegExp(secret));
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

function runNode(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      env: { ...process.env, ...(options.env || {}) },
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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
