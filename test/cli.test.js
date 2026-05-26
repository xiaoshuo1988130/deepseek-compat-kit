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

test("probe writes endpoint capability report against mock upstream", async (t) => {
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
  assert.equal(report.timeout_ms, 15000);
  assert.equal(report.fail_on_warn, false);
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

  const markdown = fs.readFileSync(markdownPath, "utf8");
  assert.match(markdown, /# DeepSeek CompatKit Capability Report/);
  assert.match(markdown, /## Execution Context/);
  assert.match(markdown, /API key env: `DEEPSEEK_API_KEY`/);
  assert.match(markdown, /API key present: no/);
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
    "--markdown",
    doctorPath,
  ], { encoding: "utf8" });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /wrote doctor report/);

  const report = fs.readFileSync(doctorPath, "utf8");
  assert.match(report, /# DeepSeek CompatKit Doctor: Auto/);
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
