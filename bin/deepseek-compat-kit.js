#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const ERROR_TEXT = "The reasoning_content in the thinking mode must be passed back to the API";

const help = `DeepSeek CompatKit

Compatibility and diagnostics for DeepSeek V4 tool-calling agents.

Commands:
  lint-schema <schema.json> [--strict] [--base-url <url>]
  diagnose <run.jsonl>
  replay <fixture.jsonl>
  sanitize <run.jsonl> --out <safe.jsonl>
  proxy [--port 8787] [--upstream https://api.deepseek.com]

Common error:
  ${ERROR_TEXT}

Proxy boundary:
  reasoning_content repair is stateful best-effort, not a stateless magic fix.
  If reasoning_content was lost before the request reached this proxy, the
  proxy can diagnose the problem but cannot reconstruct the missing content.
`;

function main() {
  const [command, ...args] = process.argv.slice(2);

  if (!command || command === "--help" || command === "-h" || command === "help") {
    console.log(help);
    return 0;
  }

  if (command === "lint-schema") return lintSchema(args);
  if (command === "diagnose") return diagnose(args);
  if (command === "replay") return diagnose(args);
  if (command === "sanitize") return sanitize(args);
  if (command === "proxy") return startProxy(args);

  console.error(`Unknown command "${command}".`);
  console.error("Run `deepseek-compat-kit --help` for usage.");
  return 2;
}

function readText(filePath) {
  if (!filePath) throw new Error("Missing file path.");
  return fs.readFileSync(path.resolve(filePath), "utf8");
}

function readJson(filePath) {
  try {
    return JSON.parse(readText(filePath));
  } catch (error) {
    throw new Error(`Failed to parse JSON file ${filePath}: ${error.message}`);
  }
}

function readJsonl(filePath) {
  return readText(filePath)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Failed to parse JSONL line ${index + 1}: ${error.message}`);
      }
    });
}

function argValue(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function lintSchema(args) {
  const filePath = args[0];
  if (!filePath) {
    console.error("Usage: deepseek-compat-kit lint-schema <schema.json> [--strict] [--base-url <url>]");
    return 2;
  }

  const document = readJson(filePath);
  const baseUrl = argValue(args, "--base-url") || "";
  const strict = args.includes("--strict") || Boolean(document?.strict || document?.function?.strict);
  const schema = extractSchema(document);
  const findings = [];

  if (strict && !baseUrl.includes("/beta")) {
    findings.push(error("DSK_SCHEMA_002", "$", "strict mode requires beta base URL: https://api.deepseek.com/beta"));
  }

  lintSchemaNode(schema, "$", findings);

  if (findings.length === 0) {
    console.log("[deepseek-compat-kit] schema ok");
    return 0;
  }

  for (const finding of findings) {
    console.log(`${finding.level} ${finding.code} ${finding.path}: ${finding.message}`);
  }

  return findings.some((finding) => finding.level === "ERROR") ? 1 : 0;
}

function extractSchema(document) {
  if (document?.type === "function" && document?.function?.parameters) return document.function.parameters;
  if (document?.function?.parameters) return document.function.parameters;
  if (document?.parameters) return document.parameters;
  return document;
}

function lintSchemaNode(node, currentPath, findings) {
  if (!node || typeof node !== "object" || Array.isArray(node)) return;

  const unsupported = [
    "minLength",
    "maxLength",
    "minItems",
    "maxItems",
  ];

  for (const key of unsupported) {
    if (Object.hasOwn(node, key)) {
      findings.push(error("DSK_SCHEMA_001", `${currentPath}.${key}`, `"${key}" is not supported by DeepSeek strict mode; validate it in application code.`));
    }
  }

  const isObject = node.type === "object" || Boolean(node.properties);
  if (isObject) {
    const properties = node.properties && typeof node.properties === "object" ? Object.keys(node.properties) : [];
    const required = Array.isArray(node.required) ? node.required : [];

    for (const property of properties) {
      if (!required.includes(property)) {
        findings.push(error("DSK_SCHEMA_003", `${currentPath}.required`, `object property "${property}" must be listed in required.`));
      }
    }

    if (node.additionalProperties !== false) {
      findings.push(error("DSK_SCHEMA_004", `${currentPath}.additionalProperties`, "object schemas must set additionalProperties: false."));
    }
  }

  if (node.properties && typeof node.properties === "object") {
    for (const [key, value] of Object.entries(node.properties)) {
      lintSchemaNode(value, `${currentPath}.properties.${key}`, findings);
    }
  }

  if (node.items) lintSchemaNode(node.items, `${currentPath}.items`, findings);
  if (Array.isArray(node.anyOf)) node.anyOf.forEach((child, index) => lintSchemaNode(child, `${currentPath}.anyOf[${index}]`, findings));
  if (Array.isArray(node.oneOf)) node.oneOf.forEach((child, index) => lintSchemaNode(child, `${currentPath}.oneOf[${index}]`, findings));
}

function diagnose(args) {
  const filePath = args[0];
  if (!filePath) {
    console.error("Usage: deepseek-compat-kit diagnose <run.jsonl>");
    return 2;
  }

  const events = readJsonl(filePath);
  const findings = diagnoseEvents(events);

  if (findings.length === 0) {
    console.log("[deepseek-compat-kit] no known DeepSeek V4 compatibility failures detected");
    return 0;
  }

  for (const finding of findings) {
    console.log(`${finding.level} ${finding.code} ${finding.path}: ${finding.message}`);
  }

  return findings.some((finding) => finding.level === "ERROR") ? 1 : 0;
}

function diagnoseEvents(events) {
  const findings = [];
  const reasoningByToolCall = new Map();

  events.forEach((event, eventIndex) => {
    const message = event?.message;
    if (event?.type === "response" && message?.reasoning_content && Array.isArray(message.tool_calls)) {
      for (const call of message.tool_calls) {
        if (call?.id) reasoningByToolCall.set(call.id, { eventIndex, hasReasoning: true });
      }
    }

    if (event?.type === "request" && Array.isArray(event.messages)) {
      event.messages.forEach((requestMessage, messageIndex) => {
        if (requestMessage?.role !== "assistant" || !Array.isArray(requestMessage.tool_calls)) return;
        for (const call of requestMessage.tool_calls) {
          if (!call?.id || !reasoningByToolCall.has(call.id)) continue;
          if (!requestMessage.reasoning_content) {
            findings.push(error(
              "DSK_REASONING_001",
              `events[${eventIndex}].messages[${messageIndex}]`,
              `assistant tool_call "${call.id}" previously had reasoning_content, but this request dropped it. ${ERROR_TEXT}`,
            ));
          }
        }
      });
    }
  });

  return findings;
}

function sanitize(args) {
  const inputPath = args[0];
  const outputPath = argValue(args, "--out");
  if (!inputPath || !outputPath) {
    console.error("Usage: deepseek-compat-kit sanitize <run.jsonl> --out <safe.jsonl>");
    return 2;
  }

  const events = readJsonl(inputPath);
  const sanitized = events.map((event) => sanitizeValue(event, { role: undefined, key: undefined }));
  fs.writeFileSync(path.resolve(outputPath), `${sanitized.map((event) => JSON.stringify(event)).join("\n")}\n`);
  console.log(`[deepseek-compat-kit] wrote sanitized replay fixture: ${outputPath}`);
  return 0;
}

function sanitizeValue(value, context) {
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, context));
  if (!value || typeof value !== "object") return sanitizeScalar(value);

  const role = typeof value.role === "string" ? value.role : context.role;
  const output = {};

  for (const [key, child] of Object.entries(value)) {
    const lowered = key.toLowerCase();

    if (isSensitiveKey(lowered)) {
      output[key] = "<redacted:sensitive>";
      continue;
    }

    if (lowered === "reasoning_content") {
      output[key] = redactedSummary("reasoning_content", child);
      continue;
    }

    if (role === "tool" && lowered === "content") {
      output[key] = redactedSummary("tool_result", child);
      continue;
    }

    output[key] = sanitizeValue(child, { role, key });
  }

  return output;
}

function sanitizeScalar(value) {
  if (typeof value !== "string") return value;
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer <redacted>")
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, "sk-<redacted>")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "<redacted:email>")
    .replace(/([?&](?:api_?key|access_?token|token|secret)=)[^&\s]+/gi, "$1<redacted>");
}

function isSensitiveKey(lowered) {
  if (["authorization", "cookie", "api_key", "apikey", "password", "secret"].includes(lowered)) return true;
  if (lowered.includes("token") && lowered !== "tool_call_id") return true;
  if (lowered.includes("secret")) return true;
  return false;
}

function redactedSummary(label, value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return `<redacted:${label} sha256=${sha256(text)} length=${text.length}>`;
}

function sha256(text) {
  return crypto.createHash("sha256").update(text || "").digest("hex").slice(0, 12);
}

function startProxy(args) {
  const port = argValue(args, "--port") || "8787";
  const upstream = normalizeBaseUrl(argValue(args, "--upstream") || process.env.DEEPSEEK_COMPAT_UPSTREAM || "https://api.deepseek.com");
  const state = createProxyState();
  const server = http.createServer((request, response) => {
    handleProxyRequest({ request, response, upstream, state }).catch((error) => {
      console.error(`[deepseek-compat-kit] proxy error: ${error.message}`);
      if (!response.headersSent) {
        response.writeHead(502, { "content-type": "application/json" });
      }
      response.end(JSON.stringify({ error: { message: "DeepSeek CompatKit proxy failed", detail: error.message } }));
    });
  });

  server.listen(Number(port), "127.0.0.1", () => {
    console.error(`[deepseek-compat-kit] proxy alpha listening on http://127.0.0.1:${port}/v1`);
    console.error(`[deepseek-compat-kit] upstream: ${upstream}`);
    console.error("[deepseek-compat-kit] boundary: reasoning_content repair is stateful best-effort, not stateless magic.");
  });

  return undefined;
}

function createProxyState() {
  return {
    reasoningByToolCallId: new Map(),
    maxEntries: 2000,
  };
}

async function handleProxyRequest({ request, response, upstream, state }) {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, name: "deepseek-compat-kit" }));
    return;
  }

  const requestUrl = new URL(request.url, "http://127.0.0.1");
  const pathname = requestUrl.pathname;
  if (request.method !== "POST" || !["/v1/chat/completions", "/chat/completions"].includes(pathname)) {
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { message: "DeepSeek CompatKit proxy only supports POST /v1/chat/completions in alpha." } }));
    return;
  }

  const bodyText = await readRequestBody(request);
  const body = parseProxyJson(bodyText);
  const repair = repairReasoningContent(body, state);
  const schemaFindings = lintRequestSchemas(body, upstream);

  for (const finding of [...repair.findings, ...schemaFindings]) {
    console.error(`${finding.level} ${finding.code} ${finding.path}: ${finding.message}`);
  }

  const upstreamPath = pathname === "/v1/chat/completions" ? "/chat/completions" : pathname;
  const upstreamUrl = `${upstream}${upstreamPath}${requestUrl.search}`;
  const upstreamResponse = await fetch(upstreamUrl, {
    method: "POST",
    headers: buildUpstreamHeaders(request.headers, body),
    body: JSON.stringify(body),
  });

  response.writeHead(upstreamResponse.status, buildResponseHeaders(upstreamResponse.headers, repair, schemaFindings));

  const contentType = upstreamResponse.headers.get("content-type") || "";
  if (body.stream || contentType.includes("text/event-stream")) {
    await pipeStreamingResponse(upstreamResponse, response, state);
    return;
  }

  const text = await upstreamResponse.text();
  rememberNonStreamingResponse(text, state);
  response.end(text);
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 25 * 1024 * 1024) {
        reject(new Error("request body exceeds 25MB alpha proxy limit"));
        request.destroy();
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function parseProxyJson(bodyText) {
  try {
    return JSON.parse(bodyText || "{}");
  } catch (error) {
    throw new Error(`invalid JSON request body: ${error.message}`);
  }
}

function repairReasoningContent(body, state) {
  const findings = [];
  let injected = 0;
  if (!Array.isArray(body.messages)) return { injected, findings };

  body.messages.forEach((message, messageIndex) => {
    if (message?.role !== "assistant" || !Array.isArray(message.tool_calls) || message.reasoning_content) return;
    const cached = message.tool_calls
      .map((call) => call?.id && state.reasoningByToolCallId.get(call.id))
      .filter(Boolean);
    if (cached.length === 0) return;

    const missingIds = message.tool_calls
      .map((call) => call?.id)
      .filter((id) => id && !state.reasoningByToolCallId.has(id));
    if (missingIds.length > 0) {
      findings.push(error(
        "DSK_REASONING_002",
        `messages[${messageIndex}]`,
        `some tool calls have no cached reasoning_content: ${missingIds.join(", ")}. The proxy cannot reconstruct content it never saw.`,
      ));
      return;
    }

    const uniqueReasoning = [...new Set(cached.map((entry) => entry.reasoningContent))];
    message.reasoning_content = uniqueReasoning.join("\n");
    injected += 1;
    findings.push(warn(
      "DSK_REASONING_003",
      `messages[${messageIndex}]`,
      `injected cached reasoning_content for ${cached.length} tool call(s).`,
    ));
  });

  return { injected, findings };
}

function lintRequestSchemas(body, upstream) {
  const findings = [];
  if (!Array.isArray(body.tools)) return findings;

  body.tools.forEach((tool, index) => {
    const strict = Boolean(tool?.function?.strict || tool?.strict);
    if (strict && !upstream.includes("/beta")) {
      findings.push(warn("DSK_SCHEMA_002", `tools[${index}]`, "strict mode usually requires DeepSeek beta base URL: https://api.deepseek.com/beta"));
    }

    const parameters = extractSchema(tool);
    const before = findings.length;
    lintSchemaNode(parameters, `tools[${index}].function.parameters`, findings);
    for (const finding of findings.slice(before)) finding.level = strict ? "ERROR" : "WARN";
  });

  return findings;
}

function buildUpstreamHeaders(headers, body) {
  const output = {
    "content-type": "application/json",
    "accept": firstHeader(headers.accept) || "application/json",
    "user-agent": "deepseek-compat-kit/0.1",
  };

  const authorization = firstHeader(headers.authorization);
  if (authorization) output.authorization = authorization;
  if (!output.authorization && process.env.DEEPSEEK_API_KEY) output.authorization = `Bearer ${process.env.DEEPSEEK_API_KEY}`;
  const requestId = firstHeader(headers["x-request-id"]);
  if (requestId) output["x-request-id"] = requestId;
  if (body.stream) output.accept = "text/event-stream";
  return output;
}

function firstHeader(value) {
  if (Array.isArray(value)) return value[0];
  return value;
}

function buildResponseHeaders(headers, repair, schemaFindings) {
  const output = {};
  for (const [key, value] of headers.entries()) {
    const lowered = key.toLowerCase();
    if (["content-encoding", "content-length", "connection", "transfer-encoding"].includes(lowered)) continue;
    output[key] = value;
  }
  output["x-deepseek-compat-kit"] = "proxy-alpha";
  output["x-deepseek-compat-reasoning-injected"] = String(repair.injected);
  output["x-deepseek-compat-schema-findings"] = String(schemaFindings.length);
  return output;
}

async function pipeStreamingResponse(upstreamResponse, response, state) {
  const decoder = new TextDecoder();
  let buffer = "";
  const streamState = new Map();

  for await (const chunk of upstreamResponse.body) {
    const text = typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
    response.write(text);
    buffer += text;
    buffer = consumeSseBuffer(buffer, streamState);
  }

  buffer += decoder.decode();
  consumeSseBuffer(`${buffer}\n\n`, streamState);
  rememberStreamingState(streamState, state);
  response.end();
}

function consumeSseBuffer(buffer, streamState) {
  const events = buffer.split(/\n\n/);
  const remainder = events.pop() || "";
  for (const event of events) {
    const dataLines = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim());
    for (const data of dataLines) {
      if (!data || data === "[DONE]") continue;
      try {
        rememberStreamingChunk(JSON.parse(data), streamState);
      } catch {
        // Ignore non-JSON SSE payloads from nonstandard gateways.
      }
    }
  }
  return remainder;
}

function rememberStreamingChunk(chunk, streamState) {
  for (const choice of chunk?.choices || []) {
    const index = choice.index ?? 0;
    const current = streamState.get(index) || { reasoning: "", toolCallIds: new Map() };
    const delta = choice.delta || {};
    if (typeof delta.reasoning_content === "string") current.reasoning += delta.reasoning_content;
    if (Array.isArray(delta.tool_calls)) {
      for (const toolCall of delta.tool_calls) {
        const callIndex = toolCall.index ?? 0;
        if (toolCall.id) current.toolCallIds.set(callIndex, toolCall.id);
      }
    }
    streamState.set(index, current);
  }
}

function rememberStreamingState(streamState, state) {
  for (const current of streamState.values()) {
    if (!current.reasoning) continue;
    for (const id of current.toolCallIds.values()) {
      rememberReasoning(id, current.reasoning, state);
    }
  }
}

function rememberNonStreamingResponse(text, state) {
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    return;
  }

  for (const choice of payload?.choices || []) {
    const message = choice.message;
    if (!message?.reasoning_content || !Array.isArray(message.tool_calls)) continue;
    for (const call of message.tool_calls) {
      if (call?.id) rememberReasoning(call.id, message.reasoning_content, state);
    }
  }
}

function rememberReasoning(toolCallId, reasoningContent, state) {
  state.reasoningByToolCallId.set(toolCallId, {
    reasoningContent,
    seenAt: Date.now(),
  });

  while (state.reasoningByToolCallId.size > state.maxEntries) {
    const oldest = state.reasoningByToolCallId.keys().next().value;
    state.reasoningByToolCallId.delete(oldest);
  }
}

function normalizeBaseUrl(value) {
  return String(value).replace(/\/+$/, "");
}

function warn(code, currentPath, message) {
  return { level: "WARN", code, path: currentPath, message };
}

function error(code, currentPath, message) {
  return { level: "ERROR", code, path: currentPath, message };
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(`[deepseek-compat-kit] ${error.message}`);
  process.exitCode = 2;
}
