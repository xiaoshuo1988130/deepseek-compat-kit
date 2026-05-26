#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const ERROR_TEXT = "The reasoning_content in the thinking mode must be passed back to the API";

const help = `DeepSeek CompatKit

Compatibility and diagnostics for DeepSeek V4 tool-calling agents.

Commands:
  compile-schema -i <schema.json> [-o <deepseek.schema.json>] [--report <report.json>] [--dry-run]
  probe --endpoint <url> [--model <model>] [--out <report.json>] [--markdown <report.md>] [--profile official|openai|relay|self-hosted]
  inventory [--path <dir>] [--out <inventory.json>] [--markdown <inventory.md>]
  doctor --target auto|opencode|cline|roo-code|openai-js|langchain-js [--path <dir>] [--markdown <doctor.md>] [--print]
  recipes [opencode|cline|roo-code|openai-js|langchain-js]
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
  if (command === "compile-schema") return compileSchema(args);
  if (command === "probe") return probeEndpoint(args);
  if (command === "inventory") return inventory(args);
  if (command === "doctor") return doctor(args);
  if (command === "recipes") return recipes(args);
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

function firstPositional(args) {
  return args.find((arg, index) => !arg.startsWith("-") && !args[index - 1]?.startsWith("--"));
}

function compileSchema(args) {
  const inputPath = argValue(args, "-i") || argValue(args, "--input") || args.find((arg) => !arg.startsWith("-"));
  const outputPath = argValue(args, "-o") || argValue(args, "--out");
  const reportPath = argValue(args, "--report");
  const dryRun = args.includes("--dry-run");

  if (!inputPath) {
    console.error("Usage: deepseek-compat-kit compile-schema -i <schema.json> [-o <deepseek.schema.json>] [--report <report.json>] [--dry-run]");
    return 2;
  }

  const document = readJson(inputPath);
  const { document: compiled, report } = compileDeepSeekSchema(document);
  const compiledText = `${JSON.stringify(compiled, null, 2)}\n`;

  if (dryRun) {
    console.log("[deepseek-compat-kit] compile-schema dry run; no files written.");
    printCompilePlan(report);
    return 0;
  }

  if (outputPath) {
    fs.writeFileSync(path.resolve(outputPath), compiledText);
    console.log(`[deepseek-compat-kit] wrote DeepSeek strict schema: ${outputPath}`);
  } else {
    process.stdout.write(compiledText);
  }

  if (reportPath) {
    fs.writeFileSync(path.resolve(reportPath), `${JSON.stringify(report, null, 2)}\n`);
    console.log(`[deepseek-compat-kit] wrote compile report: ${reportPath}`);
  } else if (report.summary.removed_constraints > 0 || report.summary.required_added > 0 || report.summary.additional_properties_fixed > 0) {
    printCompileReport(report);
  }

  return 0;
}

function compileDeepSeekSchema(document) {
  const compiled = cloneJson(document);
  const schema = extractSchema(compiled);
  const report = createCompileReport();
  compileSchemaNode(schema, "$", report);
  finalizeCompileReport(report);
  return { document: compiled, report };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function createCompileReport() {
  return {
    summary: {
      removed_constraints: 0,
      required_added: 0,
      additional_properties_fixed: 0,
    },
    removed_constraints: [],
    required_added: [],
    additional_properties_fixed: [],
    system_prompt_appendix: "",
    post_validation_plan: [],
  };
}

function compileSchemaNode(node, currentPath, report) {
  if (!node || typeof node !== "object" || Array.isArray(node)) return;

  const unsupported = [
    "minLength",
    "maxLength",
    "minItems",
    "maxItems",
  ];

  for (const key of unsupported) {
    if (Object.hasOwn(node, key)) {
      const value = node[key];
      delete node[key];
      report.summary.removed_constraints += 1;
      report.removed_constraints.push({
        path: `${currentPath}.${key}`,
        keyword: key,
        value,
        prompt_instruction: constraintPromptInstruction(currentPath, key, value),
      });
    }
  }

  const isObject = node.type === "object" || Boolean(node.properties);
  if (isObject) {
    const properties = node.properties && typeof node.properties === "object" ? Object.keys(node.properties) : [];
    const required = Array.isArray(node.required) ? [...node.required] : [];
    const added = [];

    for (const property of properties) {
      if (!required.includes(property)) {
        required.push(property);
        added.push(property);
      }
    }

    if (added.length > 0 || properties.length > 0) {
      node.required = required;
    }

    if (added.length > 0) {
      report.summary.required_added += added.length;
      report.required_added.push({ path: `${currentPath}.required`, properties: added });
    }

    if (node.additionalProperties !== false) {
      node.additionalProperties = false;
      report.summary.additional_properties_fixed += 1;
      report.additional_properties_fixed.push({ path: `${currentPath}.additionalProperties`, value: false });
    }
  }

  if (node.properties && typeof node.properties === "object") {
    for (const [key, value] of Object.entries(node.properties)) {
      compileSchemaNode(value, `${currentPath}.properties.${key}`, report);
    }
  }

  if (node.items) compileSchemaNode(node.items, `${currentPath}.items`, report);
  if (Array.isArray(node.anyOf)) node.anyOf.forEach((child, index) => compileSchemaNode(child, `${currentPath}.anyOf[${index}]`, report));
  if (Array.isArray(node.oneOf)) node.oneOf.forEach((child, index) => compileSchemaNode(child, `${currentPath}.oneOf[${index}]`, report));
  if (Array.isArray(node.allOf)) node.allOf.forEach((child, index) => compileSchemaNode(child, `${currentPath}.allOf[${index}]`, report));
}

function constraintPromptInstruction(currentPath, keyword, value) {
  const target = currentPath.replace(/^\$\./, "");
  if (keyword === "minLength") return `${target} must have a minimum string length of ${value}.`;
  if (keyword === "maxLength") return `${target} must have a maximum string length of ${value}.`;
  if (keyword === "minItems") return `${target} must contain at least ${value} item(s).`;
  if (keyword === "maxItems") return `${target} must contain at most ${value} item(s).`;
  return `${target} must satisfy ${keyword}: ${JSON.stringify(value)}.`;
}

function finalizeCompileReport(report) {
  report.post_validation_plan = report.removed_constraints.map((item) => item.prompt_instruction);
  if (report.post_validation_plan.length === 0) {
    report.system_prompt_appendix = "";
    return;
  }

  report.system_prompt_appendix = [
    "Additional validation requirements that were removed from the DeepSeek strict schema:",
    ...report.post_validation_plan.map((instruction) => `- ${instruction}`),
    "Validate these requirements in application code after the model returns structured output.",
  ].join("\n");
}

function printCompileReport(report) {
  console.log("[deepseek-compat-kit] compile report");
  console.log(`removed_constraints=${report.summary.removed_constraints}`);
  console.log(`required_added=${report.summary.required_added}`);
  console.log(`additional_properties_fixed=${report.summary.additional_properties_fixed}`);
  if (report.system_prompt_appendix) {
    console.log("system_prompt_appendix:");
    console.log(report.system_prompt_appendix);
  }
}

function printCompilePlan(report) {
  printCompileReport(report);
  console.log("planned_changes:");

  let changes = 0;
  for (const item of report.removed_constraints) {
    changes += 1;
    console.log(`- REMOVE ${item.path}: ${item.keyword}=${JSON.stringify(item.value)}`);
    console.log(`  post_validation: ${item.prompt_instruction}`);
  }

  for (const item of report.required_added) {
    changes += 1;
    console.log(`- ADD ${item.path}: ${item.properties.join(", ")}`);
  }

  for (const item of report.additional_properties_fixed) {
    changes += 1;
    console.log(`- SET ${item.path}: false`);
  }

  if (changes === 0) {
    console.log("- none");
  }
}

async function probeEndpoint(args) {
  const endpoint = argValue(args, "--endpoint") || argValue(args, "--base-url");
  const model = argValue(args, "--model") || "deepseek-chat";
  const profile = normalizeProbeProfile(argValue(args, "--profile") || "openai");
  const outputPath = argValue(args, "--out");
  const markdownPath = argValue(args, "--markdown") || argValue(args, "--out-md");

  if (!endpoint) {
    console.error("Usage: deepseek-compat-kit probe --endpoint <url> [--model <model>] [--out <report.json>] [--markdown <report.md>] [--profile official|openai|relay|self-hosted]");
    return 2;
  }
  if (!profile) {
    console.error("Unknown probe profile. Available profiles: official, openai, relay, self-hosted");
    return 2;
  }

  const baseUrl = normalizeBaseUrl(endpoint);
  const report = {
    version: "0.1",
    generated_at: new Date().toISOString(),
    endpoint: baseUrl,
    profile,
    profile_guidance: buildProbeProfileGuidance(profile, baseUrl),
    model,
    scope: "functional compatibility probe, not a benchmark",
    checks: [],
    summary: {
      status: "UNKNOWN",
      passed: 0,
      warned: 0,
      failed: 0,
    },
  };

  report.checks.push(await runProbeCheck({
    name: "chat_completions",
    capability: "chat_completions",
    description: "POST /chat/completions accepts a minimal non-streaming request.",
    impact: "Basic OpenAI-compatible request path works.",
    recommendation: "If this fails, verify that the endpoint root is correct, includes the right /v1 prefix, uses a valid API key, and exposes the selected model.",
    request: buildProbeRequest({ model, stream: false }),
    baseUrl,
  }));

  report.checks.push(await runProbeCheck({
    name: "streaming",
    capability: "streaming",
    description: "POST /chat/completions accepts stream: true and returns an event-stream-like response.",
    impact: "Streaming clients can parse incremental responses from this endpoint.",
    recommendation: "If this warns or fails, disable streaming while triaging the provider or gateway, then retest after the endpoint is fixed.",
    request: buildProbeRequest({ model, stream: true }),
    baseUrl,
    expectStream: true,
  }));

  report.checks.push(await runProbeCheck({
    name: "strict_schema_request",
    capability: "strict_schema",
    description: "Endpoint accepts a minimal strict tool schema request.",
    impact: "Tool-calling agents can send DeepSeek strict-mode compatible function schemas.",
    recommendation: "If this warns or fails, run compile-schema and lint-schema first, then confirm that the provider supports DeepSeek strict schema semantics.",
    request: buildStrictSchemaProbeRequest(model),
    baseUrl,
  }));

  summarizeProbe(report);
  const text = `${JSON.stringify(report, null, 2)}\n`;
  if (outputPath) {
    fs.writeFileSync(path.resolve(outputPath), text);
    console.log(`[deepseek-compat-kit] wrote capability report: ${outputPath}`);
  } else {
    process.stdout.write(text);
  }

  if (markdownPath) {
    fs.writeFileSync(path.resolve(markdownPath), renderProbeMarkdown(report));
    console.log(`[deepseek-compat-kit] wrote markdown capability report: ${markdownPath}`);
  }

  return report.summary.failed > 0 ? 1 : 0;
}

function normalizeProbeProfile(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["official", "deepseek", "deepseek-official"].includes(normalized)) return "official";
  if (["openai", "openai-compatible", "generic"].includes(normalized)) return "openai";
  if (["relay", "gateway", "provider", "third-party"].includes(normalized)) return "relay";
  if (["self-hosted", "self_hosted", "vllm", "ollama", "local"].includes(normalized)) return "self-hosted";
  return "";
}

function buildProbeProfileGuidance(profile, endpoint) {
  if (profile === "official") {
    return {
      name: "Official DeepSeek API",
      endpoint_hint: "Use https://api.deepseek.com for normal requests and https://api.deepseek.com/beta when validating strict-mode schema behavior.",
      strict_schema_hint: "Strict-mode tool schemas require DeepSeek-compatible object rules; run lint-schema with the beta base URL before filing endpoint issues.",
      known_risks: [
        "Do not append /v1 to the official DeepSeek endpoint unless the official docs for your API path require it.",
        "A passing normal chat check does not prove strict schema compatibility unless the strict_schema check also passes.",
      ],
      next_steps: [
        "Run the same probe against your local proxy if you use DeepSeek CompatKit in front of the official API.",
        "Attach both JSON and Markdown reports to framework issues.",
      ],
    };
  }

  if (profile === "relay") {
    return {
      name: "Third-party relay or API gateway",
      endpoint_hint: "Most relay providers expose an OpenAI-compatible /v1 base URL, but each provider may map DeepSeek beta and strict-mode behavior differently.",
      strict_schema_hint: "If strict_schema warns or fails, confirm whether the relay preserves DeepSeek strict schema semantics or silently rewrites tool definitions.",
      known_risks: [
        "Relays can buffer streaming responses and break event-stream clients.",
        "Relays can normalize errors, hiding the original DeepSeek 400 payload.",
        "Relays may not support beta endpoint behavior even if normal chat works.",
      ],
      next_steps: [
        "Re-run probe directly against official DeepSeek to separate relay bugs from upstream behavior.",
        "Ask the relay provider whether strict tool schemas and reasoning_content round-trips are preserved.",
      ],
    };
  }

  if (profile === "self-hosted") {
    return {
      name: "Self-hosted OpenAI-compatible endpoint",
      endpoint_hint: `Endpoint under test: ${endpoint}. Self-hosted servers commonly expose a /v1 base URL, but implementation details vary by vLLM, Ollama, or custom gateway version.`,
      strict_schema_hint: "Treat strict_schema as a compatibility signal, not a guarantee; many self-hosted stacks accept the request shape but do not enforce official DeepSeek strict-mode semantics.",
      known_risks: [
        "Streaming chunk shape can differ from official APIs.",
        "Tool-call IDs, strict schemas, and reasoning content may be partially implemented.",
        "Model names and tokenizer behavior may differ even when the endpoint is OpenAI-compatible.",
      ],
      next_steps: [
        "Record the server implementation and version beside the probe report.",
        "Run a framework-level smoke test after this probe passes.",
      ],
    };
  }

  return {
    name: "Generic OpenAI-compatible endpoint",
    endpoint_hint: "Confirm whether the base URL should include /v1. Do not pass a full /chat/completions URL as the endpoint.",
    strict_schema_hint: "If strict_schema warns or fails, run compile-schema and lint-schema before changing application code.",
    known_risks: [
      "OpenAI-compatible usually means request shape compatibility, not identical tool-calling semantics.",
      "Provider-specific streaming and error payloads can still break agent frameworks.",
    ],
    next_steps: [
      "Use --profile official, relay, or self-hosted when you know the endpoint type.",
      "Keep the JSON report for automated triage and the Markdown report for humans.",
    ],
  };
}

function buildProbeRequest({ model, stream }) {
  return {
    model,
    messages: [
      { role: "user", content: "Reply with exactly: ok" },
    ],
    stream,
    max_tokens: 8,
  };
}

function buildStrictSchemaProbeRequest(model) {
  return {
    model,
    messages: [
      { role: "user", content: "Return a compact search query for DeepSeek compatibility testing." },
    ],
    tools: [{
      type: "function",
      function: {
        name: "record_query",
        description: "Record a short search query.",
        strict: true,
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "A short query.",
            },
          },
          required: ["query"],
          additionalProperties: false,
        },
      },
    }],
    tool_choice: {
      type: "function",
      function: { name: "record_query" },
    },
    max_tokens: 64,
  };
}

async function runProbeCheck({ name, capability, description, impact, recommendation, request, baseUrl, expectStream = false }) {
  const started = Date.now();
  const check = {
    name,
    capability,
    description,
    impact,
    recommendation,
    status: "UNKNOWN",
    http_status: null,
    duration_ms: null,
    notes: [],
  };

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: buildProbeHeaders(request),
      body: JSON.stringify(request),
    });
    check.http_status = response.status;
    check.duration_ms = Date.now() - started;
    const contentType = response.headers.get("content-type") || "";

    if (!response.ok) {
      check.status = response.status >= 500 ? "FAIL" : "WARN";
      check.notes.push(await summarizeProbeError(response));
      return check;
    }

    if (expectStream || request.stream) {
      check.status = contentType.includes("text/event-stream") ? "PASS" : "WARN";
      if (!contentType.includes("text/event-stream")) {
        check.notes.push(`Expected text/event-stream, got ${contentType || "missing content-type"}.`);
      }
      await drainProbeResponse(response);
      return check;
    }

    const payload = await response.json();
    if (Array.isArray(payload?.choices)) {
      check.status = "PASS";
      check.notes.push(`choices=${payload.choices.length}`);
    } else {
      check.status = "WARN";
      check.notes.push("Response did not contain a choices array.");
    }
    return check;
  } catch (error) {
    check.duration_ms = Date.now() - started;
    check.status = "FAIL";
    check.notes.push(error.message);
    return check;
  }
}

function buildProbeHeaders(request) {
  const headers = {
    "content-type": "application/json",
    "accept": request.stream ? "text/event-stream" : "application/json",
    "user-agent": "deepseek-compat-kit/probe",
  };
  if (process.env.DEEPSEEK_API_KEY) headers.authorization = `Bearer ${process.env.DEEPSEEK_API_KEY}`;
  return headers;
}

async function summarizeProbeError(response) {
  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();
  const trimmed = text.trim().slice(0, 500);
  return `HTTP ${response.status} ${response.statusText}; ${contentType || "no content-type"}; ${trimmed || "empty body"}`;
}

async function drainProbeResponse(response) {
  for await (const _chunk of response.body) {
    // Drain the response so the remote endpoint can close cleanly.
  }
}

function summarizeProbe(report) {
  report.summary.capabilities = {};
  for (const check of report.checks) {
    if (check.status === "PASS") report.summary.passed += 1;
    else if (check.status === "WARN") report.summary.warned += 1;
    else report.summary.failed += 1;
    report.summary.capabilities[check.capability] = check.status;
  }

  if (report.summary.failed > 0) report.summary.status = "FAIL";
  else if (report.summary.warned > 0) report.summary.status = "WARN";
  else report.summary.status = "PASS";
}

function renderProbeMarkdown(report) {
  const lines = [
    "# DeepSeek CompatKit Capability Report",
    "",
    `Generated: ${report.generated_at}`,
    `Endpoint: \`${report.endpoint}\``,
    `Profile: \`${report.profile}\``,
    `Model: \`${report.model}\``,
    `Scope: ${report.scope}`,
    "",
    "## Profile Guidance",
    "",
    `Profile name: **${report.profile_guidance.name}**`,
    "",
    `Endpoint hint: ${report.profile_guidance.endpoint_hint}`,
    "",
    `Strict schema hint: ${report.profile_guidance.strict_schema_hint}`,
    "",
    "Known risks:",
    ...report.profile_guidance.known_risks.map((item) => `- ${item}`),
    "",
    "Next steps:",
    ...report.profile_guidance.next_steps.map((item) => `- ${item}`),
    "",
    "## Summary",
    "",
    `Status: **${report.summary.status}**`,
    "",
    `Passed: ${report.summary.passed}`,
    `Warned: ${report.summary.warned}`,
    `Failed: ${report.summary.failed}`,
    "",
    "## Checks",
    "",
    "| Capability | Check | Status | HTTP | Duration | Impact | Notes |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];

  for (const check of report.checks) {
    const notes = check.notes.length > 0 ? check.notes.join("<br>") : "";
    lines.push(`| \`${escapeMarkdownTable(check.capability)}\` | \`${escapeMarkdownTable(check.name)}\` | ${check.status} | ${check.http_status ?? ""} | ${check.duration_ms ?? ""} ms | ${escapeMarkdownTable(check.impact)} | ${escapeMarkdownTable(notes)} |`);
  }

  const actionable = report.checks.filter((check) => check.status !== "PASS");
  lines.push("", "## Recommendations", "");
  if (actionable.length === 0) {
    lines.push("- No immediate compatibility issues were detected by this functional probe.");
  } else {
    for (const check of actionable) {
      lines.push(`- \`${check.capability}\`: ${check.recommendation}`);
    }
  }

  lines.push(
    "",
    "## Boundary",
    "",
    "- This is a functional compatibility probe, not a throughput benchmark, latency benchmark, or model quality evaluation.",
    "- Passing this probe does not guarantee full framework compatibility.",
    "- If a check warns or fails, attach the JSON report and this Markdown report when opening an upstream issue.",
    "",
  );

  return `${lines.join("\n")}\n`;
}

function escapeMarkdownTable(value) {
  return String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}

function inventory(args) {
  const rootArg = argValue(args, "--path") || argValue(args, "-p") || firstPositional(args) || process.cwd();
  const outputPath = argValue(args, "--out");
  const markdownPath = argValue(args, "--markdown") || argValue(args, "--out-md");
  let report;
  try {
    report = buildInventoryReport(rootArg);
  } catch (error) {
    console.error(error.message);
    return 2;
  }

  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (outputPath) {
    fs.writeFileSync(path.resolve(outputPath), json);
    console.log(`[deepseek-compat-kit] wrote inventory report: ${outputPath}`);
  } else {
    process.stdout.write(json);
  }

  if (markdownPath) {
    fs.writeFileSync(path.resolve(markdownPath), renderInventoryMarkdown(report));
    console.log(`[deepseek-compat-kit] wrote markdown inventory report: ${markdownPath}`);
  }

  return 0;
}

function buildInventoryReport(rootArg) {
  const root = path.resolve(rootArg);
  if (!fs.existsSync(root)) {
    throw new Error(`Inventory path does not exist: ${root}`);
  }

  const report = createInventoryReport(root);
  const files = collectInventoryFiles(root);
  report.summary.files_scanned = files.length;

  for (const filePath of files) {
    inspectInventoryFile(filePath, root, report);
  }

  summarizeInventory(report);
  return report;
}

function createInventoryReport(root) {
  return {
    version: "0.1",
    generated_at: new Date().toISOString(),
    root,
    scope: "explicit local path only; no network calls; secret values are not recorded",
    summary: {
      files_scanned: 0,
      findings: 0,
      warnings: 0,
      deepseek_references: 0,
      base_urls: 0,
      models: 0,
      detected_targets: [],
    },
    findings: [],
    recommendations: [],
  };
}

function collectInventoryFiles(root) {
  const files = [];
  const rootStat = fs.statSync(root);
  if (rootStat.isFile()) return shouldScanInventoryFile(root) ? [root] : [];

  const stack = [root];
  const maxFiles = 500;
  while (stack.length > 0 && files.length < maxFiles) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!shouldSkipInventoryDirectory(entry.name)) stack.push(fullPath);
        continue;
      }

      if (entry.isFile() && shouldScanInventoryFile(fullPath)) {
        files.push(fullPath);
        if (files.length >= maxFiles) break;
      }
    }
  }

  return files;
}

function shouldSkipInventoryDirectory(name) {
  return [
    ".git",
    "node_modules",
    "dist",
    "build",
    "coverage",
    ".next",
    ".cache",
    "vendor",
  ].includes(name);
}

function shouldScanInventoryFile(filePath) {
  const base = path.basename(filePath);
  if (base.startsWith(".env")) return true;
  if (["package.json", "wrangler.toml", "opencode.json"].includes(base)) return true;
  const ext = path.extname(filePath).toLowerCase();
  return [
    ".json",
    ".js",
    ".mjs",
    ".cjs",
    ".ts",
    ".tsx",
    ".jsx",
    ".yaml",
    ".yml",
    ".toml",
    ".md",
  ].includes(ext);
}

function inspectInventoryFile(filePath, root, report) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return;
  }

  if (stat.size > 256 * 1024) return;

  let text;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch {
    return;
  }

  const relativePath = path.relative(root, filePath) || path.basename(filePath);
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => inspectInventoryLine(line, index + 1, relativePath, report));
  inspectInventoryFileName(relativePath, report);
}

function inspectInventoryLine(line, lineNumber, filePath, report) {
  const lowered = line.toLowerCase();
  if (lowered.includes("deepseek")) {
    addInventoryFinding(report, {
      level: "INFO",
      code: "DSK_INV_DEEPSEEK_REFERENCE",
      file: filePath,
      line: lineNumber,
      message: "DeepSeek reference found.",
    });
  }

  for (const url of extractInventoryUrls(line)) {
    addInventoryFinding(report, {
      level: "INFO",
      code: "DSK_INV_BASE_URL",
      file: filePath,
      line: lineNumber,
      value: url,
      message: "Provider or proxy base URL candidate found.",
    });
  }

  for (const model of extractInventoryModels(line)) {
    addInventoryFinding(report, {
      level: "INFO",
      code: "DSK_INV_MODEL",
      file: filePath,
      line: lineNumber,
      value: model,
      message: "DeepSeek model reference found.",
    });
  }

  const envSecret = detectInventoryEnvSecret(line);
  if (envSecret) {
    addInventoryFinding(report, {
      level: "WARN",
      code: "DSK_INV_SECRET_PRESENT",
      file: filePath,
      line: lineNumber,
      variable: envSecret,
      message: `Potential secret value assigned to ${envSecret}; value redacted.`,
    });
  }

  if (containsRawSecret(line)) {
    addInventoryFinding(report, {
      level: "WARN",
      code: "DSK_INV_RAW_SECRET",
      file: filePath,
      line: lineNumber,
      message: "Potential raw API key or bearer token found; value redacted.",
    });
  }

  for (const target of detectInventoryTargets(line, filePath)) {
    addInventoryFinding(report, {
      level: "INFO",
      code: "DSK_INV_TARGET",
      file: filePath,
      line: lineNumber,
      target: target.name,
      value: target.name,
      message: target.reason,
    });
  }
}

function inspectInventoryFileName(relativePath, report) {
  const base = path.basename(relativePath).toLowerCase();
  if (base === "opencode.json") {
    addInventoryFinding(report, {
      level: "INFO",
      code: "DSK_INV_TARGET",
      file: relativePath,
      line: 1,
      target: "opencode",
      value: "opencode",
      message: "OpenCode configuration file detected.",
    });
  }
}

function detectInventoryTargets(line, filePath) {
  const lowered = line.toLowerCase();
  const targets = [];
  const base = path.basename(filePath).toLowerCase();

  if (base === "package.json" || /\.(?:js|mjs|cjs|ts|tsx|jsx)$/.test(filePath)) {
    if (/(["']openai["']\s*:|from\s+["']openai["']|require\(\s*["']openai["']\s*\))/.test(line)) {
      targets.push({ name: "openai-js", reason: "OpenAI JS SDK dependency or import detected." });
    }

    if (/(["']@langchain\/openai["']\s*:|from\s+["']@langchain\/openai["']|require\(\s*["']@langchain\/openai["']\s*\))/.test(line)) {
      targets.push({ name: "langchain-js", reason: "LangChain OpenAI integration dependency or import detected." });
    }
  }

  if (/\bopencode\b/.test(lowered)) {
    targets.push({ name: "opencode", reason: "OpenCode reference detected." });
  }

  if (/\bcline\b/.test(lowered)) {
    targets.push({ name: "cline", reason: "Cline reference detected." });
  }

  if (/\b(?:roo code|roocode|roo-code)\b/.test(lowered)) {
    targets.push({ name: "roo-code", reason: "Roo Code reference detected." });
  }

  return dedupeTargets(targets);
}

function dedupeTargets(targets) {
  const seen = new Set();
  return targets.filter((target) => {
    if (seen.has(target.name)) return false;
    seen.add(target.name);
    return true;
  });
}

function extractInventoryUrls(line) {
  const urls = [];
  for (const match of line.matchAll(/https?:\/\/[^\s"'`,)<>{}\\]+/g)) {
    const url = match[0].replace(/[.;]+$/, "");
    const lowered = url.toLowerCase();
    if (lowered.includes("deepseek") || lowered.includes("127.0.0.1:8787") || lowered.includes("localhost:8787")) {
      urls.push(url);
    }
  }
  return [...new Set(urls)];
}

function extractInventoryModels(line) {
  return [...new Set(Array.from(line.matchAll(/\bdeepseek-[a-z0-9._-]+\b/gi), (match) => match[0]))];
}

function detectInventoryEnvSecret(line) {
  const match = line.match(/^\s*([A-Z0-9_]*(?:DEEPSEEK|OPENAI)[A-Z0-9_]*(?:KEY|TOKEN|SECRET)|(?:DEEPSEEK|OPENAI)_API_KEY)\s*=\s*(.+?)\s*$/i);
  if (!match) return undefined;
  const value = match[2].replace(/^['"]|['"]$/g, "").trim();
  if (!value || /^(your_|sk-\.\.\.|<|xxx|changeme|example|placeholder)/i.test(value)) return undefined;
  return match[1];
}

function containsRawSecret(line) {
  return /(?:sk-[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._~+/=-]{12,})/.test(line);
}

function addInventoryFinding(report, finding) {
  report.findings.push(finding);
}

function summarizeInventory(report) {
  report.summary.findings = report.findings.length;
  report.summary.warnings = report.findings.filter((finding) => finding.level === "WARN").length;
  report.summary.deepseek_references = report.findings.filter((finding) => finding.code === "DSK_INV_DEEPSEEK_REFERENCE").length;
  report.summary.base_urls = report.findings.filter((finding) => finding.code === "DSK_INV_BASE_URL").length;
  report.summary.models = report.findings.filter((finding) => finding.code === "DSK_INV_MODEL").length;
  report.summary.detected_targets = uniqueInventoryTargets(report);
  report.recommendations = buildInventoryRecommendations(report);
}

function uniqueInventoryTargets(report) {
  return [...new Set(report.findings
    .filter((finding) => finding.code === "DSK_INV_TARGET" && finding.target)
    .map((finding) => finding.target))]
    .sort();
}

function buildInventoryRecommendations(report) {
  const recommendations = [];
  if (report.summary.detected_targets.length === 0) {
    recommendations.push({
      code: "DSK_REC_INVENTORY_ONLY",
      command: "npx deepseek-compat-kit recipes",
      message: "No specific framework target was detected. List available recipes and choose one manually.",
    });
  } else {
    for (const target of report.summary.detected_targets) {
      recommendations.push({
        code: "DSK_REC_DOCTOR_TARGET",
        target,
        command: `npx deepseek-compat-kit doctor --target ${target} --path . --markdown ./DeepSeek_Doctor.md`,
        message: `Run the print-only doctor recipe for ${target}.`,
      });
    }
  }

  if (report.summary.base_urls > 0 || report.summary.models > 0) {
    recommendations.push({
      code: "DSK_REC_PROBE_ENDPOINT",
      command: "npx deepseek-compat-kit probe --endpoint <base-url> --model deepseek-chat --profile relay --out ./deepseek-capability-report.json --markdown ./Capability_Report.md",
      message: "Probe the endpoint before running a real agent task.",
    });
  }

  if (report.summary.warnings > 0) {
    recommendations.push({
      code: "DSK_REC_REDACT_SECRETS",
      command: "Move API keys to environment variables or a local secret store before sharing reports.",
      message: "Potential secret assignments were detected; values were redacted from this report.",
    });
  }

  return recommendations;
}

function renderInventoryRecommendations(report) {
  if (report.recommendations.length === 0) return ["- No immediate recommendations."];
  return report.recommendations.flatMap((recommendation) => [
    `- ${recommendation.message}`,
    `  - \`${escapeMarkdownTable(recommendation.command)}\``,
  ]);
}

function renderInventoryMarkdown(report) {
  const lines = [
    "# DeepSeek CompatKit Inventory Report",
    "",
    `Generated: ${report.generated_at}`,
    `Root: \`${report.root}\``,
    `Scope: ${report.scope}`,
    "",
    "## Summary",
    "",
    `Files scanned: ${report.summary.files_scanned}`,
    `Findings: ${report.summary.findings}`,
    `Warnings: ${report.summary.warnings}`,
    `DeepSeek references: ${report.summary.deepseek_references}`,
    `Base URLs: ${report.summary.base_urls}`,
    `Models: ${report.summary.models}`,
    `Detected targets: ${report.summary.detected_targets.length > 0 ? report.summary.detected_targets.map((target) => `\`${target}\``).join(", ") : "none"}`,
    "",
    "## Recommendations",
    "",
    ...renderInventoryRecommendations(report),
    "",
    "## Findings",
    "",
    "| Level | Code | File | Line | Detail |",
    "| --- | --- | --- | --- | --- |",
  ];

  if (report.findings.length === 0) {
    lines.push("| INFO | DSK_INV_EMPTY |  |  | No DeepSeek inventory findings in the scanned path. |");
  } else {
    for (const finding of report.findings) {
      const detail = finding.value || finding.variable || finding.message;
      lines.push(`| ${finding.level} | \`${finding.code}\` | \`${escapeMarkdownTable(finding.file)}\` | ${finding.line} | ${escapeMarkdownTable(detail)} |`);
    }
  }

  lines.push(
    "",
    "## Boundary",
    "",
    "- Inventory scans only the explicit local path you provide.",
    "- Secret values are never recorded; only variable names and file locations are reported.",
    "- This is a heuristic adoption report, not proof that a provider configuration is valid.",
    "",
  );

  return `${lines.join("\n")}\n`;
}

function recipes(args) {
  const target = normalizeRecipeTarget(argValue(args, "--target") || firstPositional(args));
  if (!target) {
    console.log("[deepseek-compat-kit] available recipes:");
    console.log("- opencode: print-only DeepSeek/OpenAI-compatible baseURL recipe");
    console.log("- cline: print-only Cline OpenAI-compatible baseURL recipe");
    console.log("- roo-code: print-only legacy Roo Code OpenAI-compatible baseURL recipe");
    console.log("- openai-js: print-only OpenAI JS SDK baseURL recipe");
    console.log("- langchain-js: print-only LangChain JS ChatOpenAI baseURL recipe");
    return 0;
  }

  const recipe = recipeFor(target);
  if (!recipe) {
    console.error(`Unknown recipe "${target}". Available recipes: opencode, cline, roo-code, openai-js, langchain-js`);
    return 2;
  }

  process.stdout.write(`${recipe.markdown}\n`);
  return 0;
}

function doctor(args) {
  const target = normalizeRecipeTarget(argValue(args, "--target") || firstPositional(args));
  const rootArg = argValue(args, "--path") || argValue(args, "-p");
  const markdownPath = argValue(args, "--markdown") || argValue(args, "--out-md");
  if (!target) {
    console.error("Usage: deepseek-compat-kit doctor --target auto|opencode|cline|roo-code|openai-js|langchain-js [--path <dir>] [--markdown <doctor.md>] [--print]");
    return 2;
  }

  if (target === "auto") {
    if (!rootArg) {
      console.error("Usage: deepseek-compat-kit doctor --target auto --path <dir> [--markdown <doctor.md>] [--print]");
      return 2;
    }

    let inventoryReport;
    try {
      inventoryReport = buildInventoryReport(rootArg);
    } catch (error) {
      console.error(error.message);
      return 2;
    }

    const recipes = inventoryReport.summary.detected_targets
      .map((detectedTarget) => recipeFor(detectedTarget))
      .filter(Boolean);
    const markdown = renderAutoDoctorMarkdown({ inventoryReport, recipes });
    if (markdownPath) {
      fs.writeFileSync(path.resolve(markdownPath), markdown);
      console.log(`[deepseek-compat-kit] wrote doctor report: ${markdownPath}`);
    }

    if (!markdownPath || args.includes("--print")) {
      process.stdout.write(markdown);
    }

    return 0;
  }

  const recipe = recipeFor(target);
  if (!recipe) {
    console.error(`Unknown doctor target "${target}". Available targets: auto, opencode, cline, roo-code, openai-js, langchain-js`);
    return 2;
  }

  let inventoryReport;
  if (rootArg) {
    try {
      inventoryReport = buildInventoryReport(rootArg);
    } catch (error) {
      console.error(error.message);
      return 2;
    }
  }

  const markdown = renderDoctorMarkdown({ recipe, inventoryReport });
  if (markdownPath) {
    fs.writeFileSync(path.resolve(markdownPath), markdown);
    console.log(`[deepseek-compat-kit] wrote doctor report: ${markdownPath}`);
  }

  if (!markdownPath || args.includes("--print")) {
    process.stdout.write(markdown);
  }

  return 0;
}

function renderDoctorMarkdown({ recipe, inventoryReport }) {
  const lines = [
    `# DeepSeek CompatKit Doctor: ${recipe.title}`,
    "",
    "Mode: print-only adoption report. No configuration files were modified.",
    "Status: configuration recipe only; live end-to-end validation is pending.",
    "",
  ];

  if (inventoryReport) {
    lines.push(
      "## Local Inventory Summary",
      "",
      `Root: \`${inventoryReport.root}\``,
      `Files scanned: ${inventoryReport.summary.files_scanned}`,
      `Findings: ${inventoryReport.summary.findings}`,
      `Warnings: ${inventoryReport.summary.warnings}`,
      `DeepSeek references: ${inventoryReport.summary.deepseek_references}`,
      `Base URLs: ${inventoryReport.summary.base_urls}`,
      `Models: ${inventoryReport.summary.models}`,
      `Detected targets: ${inventoryReport.summary.detected_targets.length > 0 ? inventoryReport.summary.detected_targets.map((item) => `\`${item}\``).join(", ") : "none"}`,
      "",
    );

    lines.push(
      "### Inventory Recommendations",
      "",
      ...renderInventoryRecommendations(inventoryReport),
      "",
    );

    if (inventoryReport.findings.length > 0) {
      lines.push(
        "### Inventory Findings",
        "",
        "| Level | Code | File | Line | Detail |",
        "| --- | --- | --- | --- | --- |",
      );
      for (const finding of inventoryReport.findings.slice(0, 20)) {
        const detail = finding.value || finding.variable || finding.message;
        lines.push(`| ${finding.level} | \`${finding.code}\` | \`${escapeMarkdownTable(finding.file)}\` | ${finding.line} | ${escapeMarkdownTable(detail)} |`);
      }
      if (inventoryReport.findings.length > 20) {
        lines.push(`| INFO | \`DSK_INV_TRUNCATED\` |  |  | ${inventoryReport.findings.length - 20} additional finding(s) omitted from doctor output. Use inventory for the full report. |`);
      }
      lines.push("");
    }
  } else {
    lines.push(
      "## Local Inventory Summary",
      "",
      "No local inventory path was provided. Add `--path .` to include local project hints.",
      "",
    );
  }

  lines.push(
    "## Target Recipe",
    "",
    recipe.markdown,
    "",
    "## Suggested Next Steps",
    "",
    "1. Run `inventory --path .` if this report did not include local inventory.",
    "2. Run `probe` against the endpoint you plan to use.",
    "3. Use `compile-schema --dry-run` before changing generated tool schemas.",
    "4. Keep API keys in environment variables or a local secret store.",
    "",
    "## Boundary",
    "",
    "- Doctor is a local, print-only adoption helper.",
    "- It does not edit OpenCode, Cline, Roo, or other third-party configuration files.",
    "- Secret values are not recorded.",
    "- Passing doctor output is not proof that a provider endpoint is valid; use `probe` for endpoint checks.",
    "",
  );

  return `${lines.join("\n")}\n`;
}

function renderAutoDoctorMarkdown({ inventoryReport, recipes }) {
  const lines = [
    "# DeepSeek CompatKit Doctor: Auto",
    "",
    "Mode: print-only auto adoption report. No configuration files were modified.",
    "Status: target recipes are selected from local inventory heuristics; live end-to-end validation is pending.",
    "",
    "## Local Inventory Summary",
    "",
    `Root: \`${inventoryReport.root}\``,
    `Files scanned: ${inventoryReport.summary.files_scanned}`,
    `Findings: ${inventoryReport.summary.findings}`,
    `Warnings: ${inventoryReport.summary.warnings}`,
    `DeepSeek references: ${inventoryReport.summary.deepseek_references}`,
    `Base URLs: ${inventoryReport.summary.base_urls}`,
    `Models: ${inventoryReport.summary.models}`,
    `Detected targets: ${inventoryReport.summary.detected_targets.length > 0 ? inventoryReport.summary.detected_targets.map((item) => `\`${item}\``).join(", ") : "none"}`,
    "",
    "### Inventory Recommendations",
    "",
    ...renderInventoryRecommendations(inventoryReport),
    "",
  ];

  if (inventoryReport.findings.length > 0) {
    lines.push(
      "### Inventory Findings",
      "",
      "| Level | Code | File | Line | Detail |",
      "| --- | --- | --- | --- | --- |",
    );
    for (const finding of inventoryReport.findings.slice(0, 20)) {
      const detail = finding.value || finding.variable || finding.message;
      lines.push(`| ${finding.level} | \`${finding.code}\` | \`${escapeMarkdownTable(finding.file)}\` | ${finding.line} | ${escapeMarkdownTable(detail)} |`);
    }
    if (inventoryReport.findings.length > 20) {
      lines.push(`| INFO | \`DSK_INV_TRUNCATED\` |  |  | ${inventoryReport.findings.length - 20} additional finding(s) omitted from doctor output. Use inventory for the full report. |`);
    }
    lines.push("");
  }

  lines.push("## Target Recipes", "");
  if (recipes.length === 0) {
    lines.push(
      "No specific recipe target was detected.",
      "",
      "Run `npx deepseek-compat-kit recipes` to list available recipes, or run a target-specific doctor command manually.",
      "",
    );
  } else {
    for (const recipe of recipes) {
      lines.push(recipe.markdown, "");
    }
  }

  lines.push(
    "## Suggested Next Steps",
    "",
    "1. Review the detected targets and ignore recipes that do not apply.",
    "2. Run `probe` against the endpoint you plan to use.",
    "3. Use `compile-schema --dry-run` before changing generated tool schemas.",
    "4. Keep API keys in environment variables or a local secret store.",
    "",
    "## Boundary",
    "",
    "- Auto doctor is a local, print-only adoption helper.",
    "- It does not edit OpenCode, Cline, Roo, SDK, or framework configuration files.",
    "- It selects recipes from heuristic inventory findings only.",
    "- Secret values are not recorded.",
    "- Passing doctor output is not proof that a provider endpoint is valid; use `probe` for endpoint checks.",
    "",
  );

  return `${lines.join("\n")}\n`;
}

function normalizeRecipeTarget(value) {
  if (!value) return "";
  const normalized = String(value).trim().toLowerCase();
  if (["auto", "detect", "detected"].includes(normalized)) return "auto";
  if (["opencode", "open-code", "open_code"].includes(normalized)) return "opencode";
  if (["cline", "cline-bot", "clinebot"].includes(normalized)) return "cline";
  if (["roo-code", "roocode", "roo", "roo_code"].includes(normalized)) return "roo-code";
  if (["openai-js", "openai_js", "openai", "openai-sdk", "openai-js-sdk"].includes(normalized)) return "openai-js";
  if (["langchain-js", "langchain_js", "langchain", "langchain-openai"].includes(normalized)) return "langchain-js";
  return normalized;
}

function recipeFor(target) {
  if (target === "opencode") return opencodeRecipe();
  if (target === "cline") return clineRecipe();
  if (target === "roo-code") return rooCodeRecipe();
  if (target === "openai-js") return openAiJsRecipe();
  if (target === "langchain-js") return langChainJsRecipe();
  return undefined;
}

function clineRecipe() {
  const markdown = [
    "# Cline + DeepSeek CompatKit Recipe",
    "",
    "Use this when Cline is configured through its OpenAI-compatible provider path and you want to route traffic through DeepSeek CompatKit first.",
    "",
    "Safety boundary:",
    "- This recipe is print-only.",
    "- It does not edit VS Code, Cline, or extension storage files.",
    "- It uses Cline's documented OpenAI-compatible `Base URL`, `API Key`, and `Model ID` setup path.",
    "- Live Cline end-to-end validation is pending.",
    "",
    "1. Start the local compatibility proxy:",
    "",
    "```bash",
    "DEEPSEEK_API_KEY=sk-... npx deepseek-compat-kit proxy --port 8787",
    "```",
    "",
    "2. In Cline, choose the OpenAI-compatible provider path and set:",
    "",
    "```text",
    "Base URL: http://127.0.0.1:8787/v1",
    "API Key: use your DeepSeek API key or your existing local secret flow",
    "Model ID: deepseek-chat",
    "```",
    "",
    "If you use Cline CLI auth, keep the same values but prefer shell history-safe secret handling.",
    "",
    "3. Probe the local path before running a long coding task:",
    "",
    "```bash",
    "npx deepseek-compat-kit probe --endpoint http://127.0.0.1:8787 --model deepseek-chat --out ./deepseek-capability-report.json --markdown ./Capability_Report.md",
    "```",
    "",
    "4. If Cline tool calling fails under strict schemas, preview schema conversion:",
    "",
    "```bash",
    "npx deepseek-compat-kit compile-schema -i ./tools.schema.json --dry-run",
    "```",
    "",
    "Troubleshooting:",
    "- If Cline cannot connect, test `curl http://127.0.0.1:8787/health` first.",
    "- If Cline starts a conversation before the proxy is configured, restart the task so the full conversation passes through the proxy from turn one.",
    "- If the provider UI changes, treat this recipe as the stable values to set rather than a promise about exact UI layout.",
  ].join("\n");

  return {
    title: "Cline",
    markdown,
  };
}

function rooCodeRecipe() {
  const markdown = [
    "# Roo Code + DeepSeek CompatKit Recipe",
    "",
    "Use this only when you still run a local Roo Code installation that exposes an OpenAI-compatible provider path and you want DeepSeek CompatKit to observe and diagnose the local route.",
    "",
    "Safety boundary:",
    "- This recipe is print-only.",
    "- It does not edit VS Code, Roo Code, or extension storage files.",
    "- Roo Code official docs currently show a product sunset notice; treat this as a legacy/installed-copies recipe, not a primary adoption target.",
    "- It assumes the selected Roo Code provider path accepts an OpenAI-compatible base URL.",
    "- Live Roo Code end-to-end validation is pending.",
    "",
    "1. Start the local compatibility proxy:",
    "",
    "```bash",
    "DEEPSEEK_API_KEY=sk-... npx deepseek-compat-kit proxy --port 8787",
    "```",
    "",
    "2. In Roo Code settings, choose an OpenAI-compatible provider path and set:",
    "",
    "```text",
    "Base URL: http://127.0.0.1:8787/v1",
    "API Key: use your DeepSeek API key or your existing local secret flow",
    "Model ID: deepseek-chat",
    "```",
    "",
    "If Roo Code exposes a first-party DeepSeek provider, use the OpenAI-compatible path when you need the local CompatKit proxy in the middle.",
    "",
    "3. Probe the local path before running a real task:",
    "",
    "```bash",
    "npx deepseek-compat-kit probe --endpoint http://127.0.0.1:8787 --model deepseek-chat --out ./deepseek-capability-report.json --markdown ./Capability_Report.md",
    "```",
    "",
    "4. If tool schemas fail, preview strict-mode conversion:",
    "",
    "```bash",
    "npx deepseek-compat-kit compile-schema -i ./tools.schema.json --dry-run",
    "```",
    "",
    "Troubleshooting:",
    "- If Roo Code reports a provider error, test the proxy health endpoint and then run `probe`.",
    "- If requests never reach the proxy, confirm the selected provider path really uses the custom base URL.",
    "- If reasoning_content repair is needed, start the Roo Code task only after the proxy is configured.",
  ].join("\n");

  return {
    title: "Roo Code",
    markdown,
  };
}

function langChainJsRecipe() {
  const markdown = [
    "# LangChain JS + DeepSeek CompatKit Recipe",
    "",
    "Use this when a JavaScript or TypeScript project uses `@langchain/openai` and you want to route `ChatOpenAI` through DeepSeek CompatKit.",
    "",
    "Safety boundary:",
    "- This recipe is print-only.",
    "- It does not edit LangChain project files.",
    "- It uses the documented `configuration.baseURL` path for OpenAI-compatible endpoints.",
    "- Live LangChain JS end-to-end validation is pending.",
    "",
    "1. Start the local compatibility proxy:",
    "",
    "```bash",
    "DEEPSEEK_API_KEY=sk-... npx deepseek-compat-kit proxy --port 8787",
    "```",
    "",
    "2. Configure `ChatOpenAI` with the local base URL:",
    "",
    "```ts",
    "import { ChatOpenAI } from \"@langchain/openai\";",
    "",
    "const model = new ChatOpenAI({",
    "  model: process.env.DEEPSEEK_MODEL || \"deepseek-chat\",",
    "  apiKey: process.env.DEEPSEEK_API_KEY,",
    "  configuration: {",
    "    baseURL: process.env.DEEPSEEK_BASE_URL || \"http://127.0.0.1:8787/v1\",",
    "  },",
    "});",
    "```",
    "",
    "3. Probe the local path before running an Agent:",
    "",
    "```bash",
    "npx deepseek-compat-kit probe --endpoint http://127.0.0.1:8787 --model deepseek-chat --out ./deepseek-capability-report.json --markdown ./Capability_Report.md",
    "```",
    "",
    "4. If LangChain tools are generated from Zod or JSON Schema, preview strict-mode changes:",
    "",
    "```bash",
    "npx deepseek-compat-kit compile-schema -i ./tools.schema.json --dry-run",
    "```",
    "",
    "Troubleshooting:",
    "- If LangChain retries or wraps provider errors, inspect the proxy terminal logs and the probe report first.",
    "- If tool calling fails after the first turn, verify whether the full conversation was routed through the proxy from turn one.",
    "- If schemas fail under strict mode, compile a DeepSeek-compatible copy and keep removed constraints in application validation.",
  ].join("\n");

  return {
    title: "LangChain JS",
    markdown,
  };
}

function openAiJsRecipe() {
  const markdown = [
    "# OpenAI JS SDK + DeepSeek CompatKit Recipe",
    "",
    "Use this when an existing Node.js or TypeScript project already uses the OpenAI JS SDK and you want to route it through DeepSeek CompatKit.",
    "",
    "Safety boundary:",
    "- This recipe is print-only.",
    "- It does not edit source files.",
    "- It assumes your code can configure `baseURL` explicitly.",
    "",
    "1. Start the local compatibility proxy:",
    "",
    "```bash",
    "DEEPSEEK_API_KEY=sk-... npx deepseek-compat-kit proxy --port 8787",
    "```",
    "",
    "2. Configure the OpenAI JS client with the local base URL:",
    "",
    "```js",
    "import OpenAI from \"openai\";",
    "",
    "const client = new OpenAI({",
    "  apiKey: process.env.DEEPSEEK_API_KEY,",
    "  baseURL: process.env.DEEPSEEK_BASE_URL || \"http://127.0.0.1:8787/v1\",",
    "});",
    "```",
    "",
    "3. Probe the path before using it for a real Agent task:",
    "",
    "```bash",
    "npx deepseek-compat-kit probe --endpoint http://127.0.0.1:8787 --model deepseek-chat --out ./deepseek-capability-report.json --markdown ./Capability_Report.md",
    "```",
    "",
    "4. If the project sends generated tool schemas, preview strict-mode changes first:",
    "",
    "```bash",
    "npx deepseek-compat-kit compile-schema -i ./tools.schema.json --dry-run",
    "```",
    "",
    "Troubleshooting:",
    "- If requests fail before reaching DeepSeek, check `DEEPSEEK_BASE_URL` and `curl http://127.0.0.1:8787/health`.",
    "- If strict schemas fail, run `compile-schema --dry-run` and move removed constraints into application-level validation.",
    "- If multi-turn tool calling fails with reasoning_content errors, route the whole conversation through the proxy from turn one.",
  ].join("\n");

  return {
    title: "OpenAI JS SDK",
    markdown,
  };
}

function opencodeRecipe() {
  const markdown = [
    "# OpenCode + DeepSeek CompatKit Recipe",
    "",
    "Use this when OpenCode or an OpenAI-compatible provider entry needs a local DeepSeek compatibility layer.",
    "",
    "Safety boundary:",
    "- This recipe is print-only.",
    "- It does not edit OpenCode configuration files.",
    "- It does not claim live OpenCode end-to-end validation yet.",
    "",
    "1. Start the local compatibility proxy:",
    "",
    "```bash",
    "DEEPSEEK_API_KEY=sk-... npx deepseek-compat-kit proxy --port 8787",
    "```",
    "",
    "2. In the OpenCode provider entry that supports an OpenAI-compatible base URL, set the base URL to:",
    "",
    "```text",
    "http://127.0.0.1:8787/v1",
    "```",
    "",
    "Keep the upstream API key in your environment or existing provider secret store. Do not paste API keys into issue reports.",
    "",
    "3. Probe the path before using it for a real task:",
    "",
    "```bash",
    "npx deepseek-compat-kit probe --endpoint http://127.0.0.1:8787 --model deepseek-chat --out ./deepseek-capability-report.json",
    "```",
    "",
    "4. If a tool schema fails under strict mode, compile and inspect it:",
    "",
    "```bash",
    "npx deepseek-compat-kit compile-schema -i ./tools.schema.json -o ./deepseek.tools.schema.json --report ./deepseek.schema.report.json",
    "npx deepseek-compat-kit lint-schema ./deepseek.tools.schema.json --strict --base-url https://api.deepseek.com/beta",
    "```",
    "",
    "Troubleshooting:",
    "- If OpenCode reports a provider connection error, test the proxy health endpoint: `curl http://127.0.0.1:8787/health`.",
    "- If the probe report warns on streaming, use non-streaming mode until the endpoint is verified.",
    "- If the proxy reports `DSK_REASONING_002`, route the whole conversation through the proxy from turn one.",
  ].join("\n");

  return {
    title: "OpenCode",
    markdown,
  };
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

Promise.resolve()
  .then(() => main())
  .then((code) => {
    if (typeof code === "number") process.exitCode = code;
  })
  .catch((error) => {
    console.error(`[deepseek-compat-kit] ${error.message}`);
    process.exitCode = 2;
  });
