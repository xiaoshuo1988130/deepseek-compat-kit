#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ERROR_TEXT = "The reasoning_content in the thinking mode must be passed back to the API";
const packageJsonPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json");

const help = `DeepSeek CompatKit

Compatibility and diagnostics for DeepSeek V4 tool-calling agents.

Commands:
  --version | -v | version
  compile-schema -i <schema.json> [-o <deepseek.schema.json>] [--report <report.json>] [--markdown <report.md>] [--dry-run] [--check]
  probe --endpoint <url> [--name <display-name>] [--model <model>] [--out <report.json>] [--markdown <report.md>] [--profile official|openai|relay|self-hosted] [--checks all|basic|agent|a,b] [--header "Name: Value"] [--header-env "Name=ENV_VAR"] [--baseline <report.json>] [--fail-on-regression] [--api-key-env NAME] [--timeout-ms 15000] [--fail-on-warn]
  matrix <probe-report.json...> [--out <matrix.json>] [--markdown <matrix.md>] [--require all|basic|agent|a,b] [--fail-on-fail] [--fail-on-warn] [--fail-on-regression]
  inventory [--path <dir>] [--max-files 500] [--out <inventory.json>] [--markdown <inventory.md>]
  doctor --target auto|opencode|cline|roo-code|openrouter|openai-js|langchain-js [--path <dir>] [--max-files 500] [--markdown <doctor.md>] [--print]
  recipes [opencode|cline|roo-code|openrouter|openai-js|langchain-js]
  lint-schema <schema.json> [--strict] [--base-url <url>]
  diagnose <run.jsonl> [--out <report.json>] [--markdown <report.md>] [--fail-on-warn]
  replay <fixture.jsonl>
  sanitize <run.jsonl> --out <safe.jsonl>
  proxy [--port 8787] [--upstream https://api.deepseek.com] [--upstream-api-key-env NAME] [--upstream-timeout-ms 30000] [--state-ttl-ms 3600000] [--diagnostics-log <run.jsonl>] [--upstream-header "Name: Value"] [--upstream-header-env "Name=ENV_VAR"]

Common error:
  ${ERROR_TEXT}

Proxy boundary:
  reasoning_content repair is stateful conservative, not a stateless magic fix.
  If reasoning_content was lost before the request reached this proxy, the
  proxy can diagnose the problem but cannot reconstruct the missing content.
`;

const commandUsage = {
  "compile-schema": "Usage: deepseek-compat-kit compile-schema -i <schema.json> [-o <deepseek.schema.json>] [--report <report.json>] [--markdown <report.md>] [--dry-run] [--check]",
  probe: "Usage: deepseek-compat-kit probe --endpoint <url> [--name <display-name>] [--model <model>] [--out <report.json>] [--markdown <report.md>] [--profile official|openai|relay|self-hosted] [--checks all|basic|agent|a,b] [--header \"Name: Value\"] [--header-env \"Name=ENV_VAR\"] [--baseline <report.json>] [--fail-on-regression] [--api-key-env NAME] [--timeout-ms 15000] [--fail-on-warn]",
  matrix: "Usage: deepseek-compat-kit matrix <probe-report.json...> [--out <matrix.json>] [--markdown <matrix.md>] [--require all|basic|agent|a,b] [--fail-on-fail] [--fail-on-warn] [--fail-on-regression]",
  inventory: "Usage: deepseek-compat-kit inventory [--path <dir>] [--max-files 500] [--out <inventory.json>] [--markdown <inventory.md>]",
  doctor: "Usage: deepseek-compat-kit doctor --target auto|opencode|cline|roo-code|openrouter|openai-js|langchain-js [--path <dir>] [--max-files 500] [--markdown <doctor.md>] [--print]",
  recipes: "Usage: deepseek-compat-kit recipes [opencode|cline|roo-code|openrouter|openai-js|langchain-js]",
  "lint-schema": "Usage: deepseek-compat-kit lint-schema <schema.json> [--strict] [--base-url <url>]",
  diagnose: "Usage: deepseek-compat-kit diagnose <run.jsonl> [--out <report.json>] [--markdown <report.md>] [--fail-on-warn]",
  replay: "Usage: deepseek-compat-kit replay <fixture.jsonl> [--out <report.json>] [--markdown <report.md>] [--fail-on-warn]",
  sanitize: "Usage: deepseek-compat-kit sanitize <run.jsonl> --out <safe.jsonl>",
  proxy: "Usage: deepseek-compat-kit proxy [--port 8787] [--upstream https://api.deepseek.com] [--upstream-api-key-env NAME] [--upstream-timeout-ms 30000] [--state-ttl-ms 3600000] [--diagnostics-log <run.jsonl>] [--upstream-header \"Name: Value\"] [--upstream-header-env \"Name=ENV_VAR\"]",
};

function main() {
  const [command, ...args] = process.argv.slice(2);

  if (command === "help" && args[0] && commandUsage[args[0]]) {
    return printUsage(args[0]);
  }

  if (!command || command === "--help" || command === "-h" || command === "help") {
    console.log(help);
    return 0;
  }
  if (command === "--version" || command === "-v" || command === "version") {
    console.log(`deepseek-compat-kit ${packageVersion()}`);
    return 0;
  }

  if (command === "lint-schema") return lintSchema(args);
  if (command === "compile-schema") return compileSchema(args);
  if (command === "probe") return probeEndpoint(args);
  if (command === "matrix") return providerMatrix(args);
  if (command === "inventory") return inventory(args);
  if (command === "doctor") return doctor(args);
  if (command === "recipes") return recipes(args);
  if (command === "diagnose") return diagnose(args);
  if (command === "replay") return wantsHelp(args) ? printUsage("replay") : diagnose(args);
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

function packageVersion() {
  try {
    return readJson(packageJsonPath).version || "unknown";
  } catch {
    return "unknown";
  }
}

function readJsonl(filePath) {
  const events = [];
  readText(filePath)
    .split(/\r?\n/)
    .forEach((rawLine, index) => {
      const line = rawLine.trim();
      if (!line) return;
      try {
        events.push(JSON.parse(line));
      } catch (error) {
        throw new Error(`Failed to parse JSONL line ${index + 1} in ${filePath}: ${error.message}`);
      }
    });
  return events;
}

function writeTextFile(filePath, contents) {
  const resolved = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, contents);
}

function argValue(args, name) {
  const index = args.indexOf(name);
  if (index !== -1) return args[index + 1];

  const prefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  return inline ? inline.slice(prefix.length) : undefined;
}

function argValues(args, name) {
  const values = [];
  const prefix = `${name}=`;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name) values.push(args[index + 1]);
    if (args[index].startsWith(prefix)) values.push(args[index].slice(prefix.length));
  }
  return values.filter((value) => value !== undefined);
}

function wantsHelp(args) {
  return args.includes("--help") || args.includes("-h") || args.includes("help");
}

function printUsage(command) {
  console.log(commandUsage[command]);
  return 0;
}

function positiveIntegerArg(args, name, defaultValue) {
  const rawValue = argValue(args, name);
  const value = rawValue === undefined ? defaultValue : Number(rawValue);
  if (!Number.isInteger(value) || value <= 0) return undefined;
  return value;
}

function firstPositional(args, valueOptions = []) {
  return positionalArgs(args, valueOptions)[0];
}

function positionalArgs(args, valueOptions = []) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (valueOptions.includes(arg)) {
      index += 1;
      continue;
    }
    if (arg.startsWith("-")) continue;
    values.push(arg);
  }
  return values;
}

function compileSchema(args) {
  if (wantsHelp(args)) return printUsage("compile-schema");

  const inputPath = argValue(args, "-i") || argValue(args, "--input") || firstPositional(args, [
    "-i",
    "--input",
    "-o",
    "--out",
    "--report",
    "--markdown",
    "--out-md",
  ]);
  const outputPath = argValue(args, "-o") || argValue(args, "--out");
  const reportPath = argValue(args, "--report");
  const markdownPath = argValue(args, "--markdown") || argValue(args, "--out-md");
  const dryRun = args.includes("--dry-run");
  const checkOnly = args.includes("--check");

  if (!inputPath) {
    console.error(commandUsage["compile-schema"]);
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

  if (checkOnly) {
    console.log("[deepseek-compat-kit] compile-schema check; no files written.");
    printCompilePlan(report);
    if (hasCompileReportChanges(report)) {
      console.log("[deepseek-compat-kit] schema requires DeepSeek strict-mode repairs.");
      return 1;
    }
    console.log("[deepseek-compat-kit] schema already DeepSeek strict-mode compatible.");
    return 0;
  }

  if (outputPath) {
    writeTextFile(outputPath, compiledText);
    console.log(`[deepseek-compat-kit] wrote DeepSeek strict schema: ${outputPath}`);
  } else {
    process.stdout.write(compiledText);
  }

  if (reportPath) {
    writeTextFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`[deepseek-compat-kit] wrote compile report: ${reportPath}`);
  }

  if (markdownPath) {
    writeTextFile(markdownPath, renderCompileMarkdown(report));
    console.log(`[deepseek-compat-kit] wrote markdown compile report: ${markdownPath}`);
  }

  if (!reportPath && !markdownPath && hasCompileReportChanges(report)) {
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

function hasCompileReportChanges(report) {
  return report.summary.removed_constraints > 0
    || report.summary.required_added > 0
    || report.summary.additional_properties_fixed > 0;
}

function renderCompileMarkdown(report) {
  const lines = [
    "# DeepSeek CompatKit Schema Compile Report",
    "",
    "Scope: generated JSON Schema / function schema conversion for DeepSeek strict-mode compatibility.",
    "",
    "## Summary",
    "",
    `Removed constraints: ${report.summary.removed_constraints}`,
    `Required fields added: ${report.summary.required_added}`,
    `additionalProperties fixed: ${report.summary.additional_properties_fixed}`,
    "",
    "## Removed Constraints",
    "",
    "| Path | Keyword | Value | Post-validation |",
    "| --- | --- | --- | --- |",
  ];

  if (report.removed_constraints.length === 0) {
    lines.push("|  |  |  | No unsupported constraints were removed. |");
  } else {
    for (const item of report.removed_constraints) {
      lines.push(`| \`${escapeMarkdownTable(item.path)}\` | \`${escapeMarkdownTable(item.keyword)}\` | \`${escapeMarkdownTable(JSON.stringify(item.value))}\` | ${escapeMarkdownTable(item.prompt_instruction)} |`);
    }
  }

  lines.push(
    "",
    "## Required Fields Added",
    "",
    "| Path | Properties |",
    "| --- | --- |",
  );

  if (report.required_added.length === 0) {
    lines.push("|  | No required fields were added. |");
  } else {
    for (const item of report.required_added) {
      lines.push(`| \`${escapeMarkdownTable(item.path)}\` | ${escapeMarkdownTable(item.properties.join(", "))} |`);
    }
  }

  lines.push(
    "",
    "## additionalProperties Fixes",
    "",
    "| Path | Value |",
    "| --- | --- |",
  );

  if (report.additional_properties_fixed.length === 0) {
    lines.push("|  | No additionalProperties fixes were needed. |");
  } else {
    for (const item of report.additional_properties_fixed) {
      lines.push(`| \`${escapeMarkdownTable(item.path)}\` | \`${String(item.value)}\` |`);
    }
  }

  lines.push(
    "",
    "## System Prompt Appendix",
    "",
  );

  if (report.system_prompt_appendix) {
    lines.push("```text", report.system_prompt_appendix, "```");
  } else {
    lines.push("No prompt appendix is required.");
  }

  lines.push(
    "",
    "## Post-validation Plan",
    "",
  );

  if (report.post_validation_plan.length === 0) {
    lines.push("- No application-level post-validation was moved out of the schema.");
  } else {
    for (const item of report.post_validation_plan) {
      lines.push(`- ${item}`);
    }
  }

  lines.push(
    "",
    "## Boundary",
    "",
    "- This report describes schema-shape conversion, not model quality.",
    "- Removed constraints should be enforced in application code after structured output is returned.",
    "- Review the generated schema before using it in production.",
    "",
  );

  return `${lines.join("\n")}\n`;
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
  if (wantsHelp(args)) return printUsage("probe");

  const endpoint = argValue(args, "--endpoint") || argValue(args, "--base-url");
  const reportName = argValue(args, "--name") || argValue(args, "--label") || "";
  const model = argValue(args, "--model") || "deepseek-chat";
  const profile = normalizeProbeProfile(argValue(args, "--profile") || "openai");
  const outputPath = argValue(args, "--out");
  const markdownPath = argValue(args, "--markdown") || argValue(args, "--out-md");
  const failOnWarn = args.includes("--fail-on-warn");
  const timeoutMsRaw = argValue(args, "--timeout-ms");
  const timeoutMs = timeoutMsRaw === undefined ? 15000 : Number(timeoutMsRaw);
  const apiKeyEnv = argValue(args, "--api-key-env") || resolveProbeApiKeyEnv();
  const apiKey = apiKeyEnv ? process.env[apiKeyEnv] : "";
  const selectedChecks = parseProbeChecks(argValue(args, "--checks") || "all");
  const baselinePath = argValue(args, "--baseline");
  const failOnRegression = args.includes("--fail-on-regression");
  const literalHeaders = parseProbeHeaders(argValues(args, "--header"));
  const envHeaders = parseProbeHeaderEnvs(argValues(args, "--header-env"), process.env);

  if (!endpoint) {
    console.error(commandUsage.probe);
    return 2;
  }
  if (!profile) {
    console.error("Unknown probe profile. Available profiles: official, openai, relay, self-hosted");
    return 2;
  }
  if (!selectedChecks) {
    console.error(`Unknown probe check. Available checks: ${availableProbeCheckCapabilities().join(", ")}`);
    return 2;
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    console.error("--timeout-ms must be a positive integer.");
    return 2;
  }
  if (!literalHeaders) {
    console.error("--header must use the form \"Name: Value\" and valid HTTP token header names.");
    return 2;
  }
  if (envHeaders.error) {
    console.error(envHeaders.error);
    return 2;
  }
  const baselineReport = loadProbeBaselineForComparison(baselinePath);
  if (baselineReport?.error) {
    console.error(baselineReport.error);
    return 2;
  }

  const endpointInfo = normalizeProbeEndpoint(endpoint);
  const baseUrl = endpointInfo.baseUrl;
  const extraHeaders = { ...envHeaders.headers, ...literalHeaders };
  const report = {
    version: "0.1",
    generated_at: new Date().toISOString(),
    name: reportName || null,
    endpoint_input: endpoint,
    endpoint: baseUrl,
    endpoint_diagnostics: endpointInfo.diagnostics,
    profile,
    profile_guidance: buildProbeProfileGuidance(profile, baseUrl),
    model,
    auth: {
      api_key_env: apiKeyEnv || null,
      api_key_present: Boolean(apiKey),
    },
    extra_headers: {
      count: Object.keys(extraHeaders).length,
      names: Object.keys(extraHeaders),
      env: envHeaders.metadata,
    },
    checks_requested: selectedChecks,
    baseline_path: baselinePath || null,
    fail_on_regression: failOnRegression,
    timeout_ms: timeoutMs,
    fail_on_warn: failOnWarn,
    scope: "functional compatibility probe, not a benchmark",
    checks: [],
    summary: {
      status: "UNKNOWN",
      passed: 0,
      warned: 0,
      failed: 0,
    },
  };

  for (const check of buildProbeChecks(model, baseUrl, apiKey, timeoutMs, extraHeaders)) {
    if (!selectedChecks.includes(check.capability)) continue;
    report.checks.push(await runProbeCheck(check));
  }

  summarizeProbe(report);
  if (baselineReport?.report) {
    report.baseline = compareProbeBaseline(baselineReport.report, report, baselinePath);
  }

  const text = `${JSON.stringify(report, null, 2)}\n`;
  if (outputPath) {
    writeTextFile(outputPath, text);
    console.log(`[deepseek-compat-kit] wrote capability report: ${outputPath}`);
  } else {
    process.stdout.write(text);
  }

  if (markdownPath) {
    writeTextFile(markdownPath, renderProbeMarkdown(report));
    console.log(`[deepseek-compat-kit] wrote markdown capability report: ${markdownPath}`);
  }

  if (outputPath || markdownPath) {
    printProbeConsoleSummary(report);
  }

  if (report.summary.failed > 0) return 1;
  if (failOnRegression && report.baseline?.regressions?.length > 0) return 1;
  if (failOnWarn && report.summary.warned > 0) return 1;
  return 0;
}

function printProbeConsoleSummary(report) {
  console.log(`[deepseek-compat-kit] probe summary: ${report.summary.status} (${report.summary.passed} passed, ${report.summary.warned} warned, ${report.summary.failed} failed)`);
  console.log(`[deepseek-compat-kit] capabilities: ${formatProbeCapabilities(report.summary.capabilities)}`);

  if (report.baseline) {
    console.log(`[deepseek-compat-kit] baseline: ${report.baseline.status} (${report.baseline.regressions.length} regressions, ${report.baseline.improvements.length} improvements)`);
  }

  const attention = report.checks
    .filter((check) => check.status !== "PASS")
    .slice(0, 3);

  if (attention.length === 0) {
    console.log("[deepseek-compat-kit] no immediate capability issues detected");
    return;
  }

  console.log("[deepseek-compat-kit] attention:");
  for (const check of attention) {
    const firstNote = check.notes?.[0] ? ` - ${check.notes[0]}` : "";
    console.log(`- ${check.capability}: ${check.status}${firstNote}`);
  }
}

function formatProbeCapabilities(capabilities = {}) {
  const entries = Object.entries(capabilities);
  if (entries.length === 0) return "none";
  return entries.map(([capability, status]) => `${capability}=${status}`).join(", ");
}

function compareProbeBaseline(baseline, current, baselinePath) {
  const baselineCapabilities = baseline?.summary?.capabilities || {};
  const currentCapabilities = current?.summary?.capabilities || {};
  const capabilities = [...new Set([
    ...Object.keys(baselineCapabilities),
    ...Object.keys(currentCapabilities),
  ])].sort();
  const comparison = {
    path: baselinePath,
    generated_at: baseline?.generated_at || null,
    endpoint: baseline?.endpoint || null,
    status: "UNCHANGED",
    regressions: [],
    improvements: [],
    unchanged: [],
  };

  for (const capability of capabilities) {
    const previous = baselineCapabilities[capability] || "MISSING";
    const currentStatus = currentCapabilities[capability] || "MISSING";
    const item = { capability, previous, current: currentStatus };
    const delta = probeStatusRank(currentStatus) - probeStatusRank(previous);
    if (delta < 0) comparison.regressions.push(item);
    else if (delta > 0) comparison.improvements.push(item);
    else comparison.unchanged.push(item);
  }

  if (comparison.regressions.length > 0) comparison.status = "REGRESSED";
  else if (comparison.improvements.length > 0) comparison.status = "IMPROVED";
  return comparison;
}

function probeStatusRank(status) {
  if (status === "PASS") return 3;
  if (status === "WARN") return 2;
  if (status === "FAIL") return 1;
  return 0;
}

function buildProbeChecks(model, baseUrl, apiKey, timeoutMs, extraHeaders = {}) {
  return [{
    name: "chat_completions",
    capability: "chat_completions",
    description: "POST /chat/completions accepts a minimal non-streaming request.",
    impact: "Basic OpenAI-compatible request path works.",
    recommendation: "If this fails, verify that the endpoint root is correct, includes the right /v1 prefix, uses a valid API key, and exposes the selected model.",
    request: buildProbeRequest({ model, stream: false }),
    baseUrl,
    apiKey,
    timeoutMs,
    extraHeaders,
  }, {
    name: "streaming",
    capability: "streaming",
    description: "POST /chat/completions accepts stream: true and returns an event-stream-like response.",
    impact: "Streaming clients can parse incremental responses from this endpoint.",
    recommendation: "If this warns or fails, disable streaming while triaging the provider or gateway, then retest after the endpoint is fixed.",
    request: buildProbeRequest({ model, stream: true }),
    baseUrl,
    expectStream: true,
    apiKey,
    timeoutMs,
    extraHeaders,
  }, {
    name: "multi_turn_tool_messages",
    capability: "multi_turn_tool_messages",
    description: "Endpoint accepts a follow-up request containing assistant tool_calls, reasoning_content, and tool results.",
    impact: "Multi-turn tool-calling agents can pass DeepSeek reasoning_content back alongside tool results.",
    recommendation: "If this warns or fails, confirm that the framework preserves reasoning_content and that the provider accepts DeepSeek tool-call message history.",
    request: buildMultiTurnToolProbeRequest(model),
    baseUrl,
    apiKey,
    timeoutMs,
    extraHeaders,
  }, {
    name: "strict_schema_request",
    capability: "strict_schema",
    description: "Endpoint accepts a minimal strict tool schema request and returns the requested tool call.",
    impact: "Tool-calling agents can send DeepSeek strict-mode compatible function schemas and receive usable tool_calls.",
    recommendation: "If this warns or fails, run compile-schema and lint-schema first, then confirm that the provider supports DeepSeek strict schema semantics.",
    request: buildStrictSchemaProbeRequest(model),
    baseUrl,
    validatePayload: (payload) => validateToolCallPayload(payload, "record_query"),
    apiKey,
    timeoutMs,
    extraHeaders,
  }];
}

function availableProbeCheckCapabilities() {
  return [
    "chat_completions",
    "streaming",
    "multi_turn_tool_messages",
    "strict_schema",
  ];
}

function parseProbeChecks(value) {
  const raw = String(value || "").trim();
  if (!raw || raw.toLowerCase() === "all") return availableProbeCheckCapabilities();
  const names = raw.split(",").flatMap((item) => expandProbeCheckName(item)).filter(Boolean);
  if (names.length === 0) return null;
  if (names.some((name) => !availableProbeCheckCapabilities().includes(name))) return null;
  return [...new Set(names)];
}

function parseProbeHeaders(values) {
  const headers = {};
  for (const raw of values || []) {
    const separator = String(raw).indexOf(":");
    if (separator <= 0) return null;
    const name = String(raw).slice(0, separator).trim().toLowerCase();
    const value = String(raw).slice(separator + 1).trim();
    if (!isSafeProbeHeaderName(name) || !value) return null;
    headers[name] = value;
  }
  return headers;
}

function parseProbeHeaderEnvs(values, env) {
  const headers = {};
  const metadata = [];
  for (const raw of values || []) {
    const separator = String(raw).indexOf("=");
    if (separator <= 0) {
      return { error: "--header-env must use the form \"Name=ENV_VAR\".", headers: {}, metadata: [] };
    }
    const name = String(raw).slice(0, separator).trim().toLowerCase();
    const envName = String(raw).slice(separator + 1).trim();
    if (!isSafeProbeHeaderName(name) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(envName)) {
      return { error: "--header-env must use a valid HTTP token header name and environment variable name.", headers: {}, metadata: [] };
    }
    const value = env[envName];
    if (!value) {
      return { error: `--header-env ${name}=${envName} was requested, but ${envName} is not set.`, headers: {}, metadata: [] };
    }
    headers[name] = value;
    metadata.push({ name, env: envName, present: true });
  }
  return { headers, metadata };
}

function isSafeProbeHeaderName(name) {
  if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/i.test(name)) return false;
  return !["host", "content-length", "connection", "transfer-encoding"].includes(name);
}

function expandProbeCheckName(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/-/g, "_");
  if (!normalized) return [];
  if (normalized === "all") return availableProbeCheckCapabilities();
  if (normalized === "basic") return ["chat_completions", "streaming"];
  if (normalized === "agent") return ["multi_turn_tool_messages", "strict_schema"];
  return [normalizeProbeCheckName(normalized)];
}

function normalizeProbeCheckName(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/-/g, "_");
  if (["chat", "chat_completion", "chat_completions"].includes(normalized)) return "chat_completions";
  if (["stream", "streaming"].includes(normalized)) return "streaming";
  if (["multi_turn", "tool_messages", "multi_turn_tool_messages", "reasoning_content"].includes(normalized)) return "multi_turn_tool_messages";
  if (["strict", "strict_schema", "schema"].includes(normalized)) return "strict_schema";
  return normalized;
}

function normalizeProbeEndpoint(value) {
  const raw = String(value || "").trim();
  const diagnostics = [];
  let url;

  try {
    url = new URL(normalizeBaseUrl(raw));
  } catch {
    return {
      baseUrl: normalizeBaseUrl(raw),
      diagnostics: [{
        level: "WARN",
        code: "DSK_PROBE_ENDPOINT_PARSE",
        message: "Endpoint could not be parsed as a URL. It will be used as provided after trimming trailing slashes.",
      }],
    };
  }

  if (url.search || url.hash) {
    diagnostics.push({
      level: "INFO",
      code: "DSK_PROBE_ENDPOINT_STRIPPED_SUFFIX",
      message: "Removed query string or hash from probe endpoint.",
    });
    url.search = "";
    url.hash = "";
  }

  const normalizedPath = url.pathname.replace(/\/+$/, "");
  if (normalizedPath.endsWith("/chat/completions")) {
    url.pathname = normalizedPath.slice(0, -"/chat/completions".length) || "/";
    diagnostics.push({
      level: "WARN",
      code: "DSK_PROBE_ENDPOINT_CHAT_COMPLETIONS",
      message: "Endpoint included /chat/completions. Probe expects a base URL and normalized it before sending requests.",
    });
  }

  return {
    baseUrl: normalizeBaseUrl(url.toString()),
    diagnostics,
  };
}

function normalizeProbeProfile(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["official", "deepseek", "deepseek-official"].includes(normalized)) return "official";
  if (["openai", "openai-compatible", "generic"].includes(normalized)) return "openai";
  if (["relay", "gateway", "provider", "third-party"].includes(normalized)) return "relay";
  if (["self-hosted", "self_hosted", "vllm", "ollama", "local"].includes(normalized)) return "self-hosted";
  return "";
}

function resolveProbeApiKeyEnv() {
  if (process.env.DEEPSEEK_API_KEY) return "DEEPSEEK_API_KEY";
  if (process.env.OPENAI_API_KEY) return "OPENAI_API_KEY";
  return "DEEPSEEK_API_KEY";
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

function buildMultiTurnToolProbeRequest(model) {
  return {
    model,
    messages: [
      { role: "user", content: "Use the weather tool for Paris." },
      {
        role: "assistant",
        content: null,
        reasoning_content: "I need to call the weather tool before answering.",
        tool_calls: [{
          id: "call_probe_weather",
          type: "function",
          function: {
            name: "get_weather",
            arguments: "{\"city\":\"Paris\"}",
          },
        }],
      },
      {
        role: "tool",
        tool_call_id: "call_probe_weather",
        content: "{\"city\":\"Paris\",\"weather\":\"sunny\"}",
      },
      { role: "user", content: "Reply with exactly: ok" },
    ],
    tools: [{
      type: "function",
      function: {
        name: "get_weather",
        description: "Return simple weather data for a city.",
        parameters: {
          type: "object",
          properties: {
            city: {
              type: "string",
              description: "City name.",
            },
          },
          required: ["city"],
          additionalProperties: false,
        },
      },
    }],
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

async function runProbeCheck({ name, capability, description, impact, recommendation, request, baseUrl, expectStream = false, validatePayload = null, apiKey = "", timeoutMs = 15000, extraHeaders = {} }) {
  const started = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
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
      headers: buildProbeHeaders(request, apiKey, extraHeaders),
      body: JSON.stringify(request),
      signal: controller.signal,
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
      if (validatePayload) {
        const validationNotes = validatePayload(payload);
        if (validationNotes.length > 0) {
          check.status = "WARN";
          check.notes.push(...validationNotes);
        }
      }
    } else {
      check.status = "WARN";
      check.notes.push("Response did not contain a choices array.");
    }
    return check;
  } catch (error) {
    check.duration_ms = Date.now() - started;
    check.status = "FAIL";
    check.notes.push(error.name === "AbortError" ? `Timed out after ${timeoutMs} ms.` : error.message);
    return check;
  } finally {
    clearTimeout(timeoutId);
  }
}

function validateToolCallPayload(payload, expectedFunctionName) {
  const toolCalls = payload.choices
    .flatMap((choice) => choice?.message?.tool_calls || [])
    .filter(Boolean);

  if (toolCalls.length === 0) {
    return ["Response did not include tool_calls even though the request forced a tool call."];
  }

  if (expectedFunctionName && !toolCalls.some((toolCall) => toolCall?.function?.name === expectedFunctionName)) {
    return [`Response tool_calls did not include expected function ${expectedFunctionName}.`];
  }

  return [];
}

function buildProbeHeaders(request, apiKey = "", extraHeaders = {}) {
  const headers = {
    "content-type": "application/json",
    "accept": request.stream ? "text/event-stream" : "application/json",
    "user-agent": "deepseek-compat-kit/probe",
    ...extraHeaders,
  };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  return headers;
}

async function summarizeProbeError(response) {
  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();
  const trimmed = sanitizeScalar(text.trim()).slice(0, 500);
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
    `Name: ${report.name ? `\`${escapeMarkdownTable(report.name)}\`` : "none"}`,
    `Endpoint input: \`${report.endpoint_input}\``,
    `Endpoint: \`${report.endpoint}\``,
    `Profile: \`${report.profile}\``,
    `Model: \`${report.model}\``,
    `Scope: ${report.scope}`,
    "",
    "## Endpoint Diagnostics",
    "",
    ...renderProbeEndpointDiagnostics(report),
    "",
    "## Execution Context",
    "",
    `API key env: \`${report.auth?.api_key_env || "none"}\``,
    `API key present: ${report.auth?.api_key_present ? "yes" : "no"}`,
    `Extra headers: ${renderInlineCodeList(report.extra_headers?.names || [])}`,
    `Extra header env vars: ${renderProbeHeaderEnvList(report.extra_headers?.env || [])}`,
    `Checks requested: ${renderInlineCodeList(report.checks_requested || report.checks.map((check) => check.capability))}`,
    `Timeout: ${report.timeout_ms ?? "not recorded"} ms`,
    `Fail on warn: ${report.fail_on_warn ? "yes" : "no"}`,
    `Baseline: ${report.baseline_path ? `\`${report.baseline_path}\`` : "none"}`,
    `Fail on regression: ${report.fail_on_regression ? "yes" : "no"}`,
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
  if (report.baseline) {
    lines.push("", "## Baseline Comparison", "");
    lines.push(`Status: **${report.baseline.status}**`);
    lines.push(`Baseline report: \`${report.baseline.path}\``);
    lines.push(`Regressions: ${report.baseline.regressions.length}`);
    lines.push(`Improvements: ${report.baseline.improvements.length}`);
    if (report.baseline.regressions.length > 0) {
      lines.push("", "| Capability | Previous | Current |", "| --- | --- | --- |");
      for (const item of report.baseline.regressions) {
        lines.push(`| \`${escapeMarkdownTable(item.capability)}\` | ${item.previous} | ${item.current} |`);
      }
    }
  }

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

function renderProbeEndpointDiagnostics(report) {
  if (!report.endpoint_diagnostics || report.endpoint_diagnostics.length === 0) {
    return ["- No endpoint normalization warnings."];
  }

  return report.endpoint_diagnostics.map((item) => `- ${item.level} \`${item.code}\`: ${item.message}`);
}

function renderInlineCodeList(items) {
  return (items || []).map((item) => `\`${escapeMarkdownTable(item)}\``).join(", ") || "none";
}

function renderProbeHeaderEnvList(items) {
  if (!items || items.length === 0) return "none";
  return items.map((item) => `\`${escapeMarkdownTable(item.name)}=${escapeMarkdownTable(item.env)}\``).join(", ");
}

function escapeMarkdownTable(value) {
  return String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}

function providerMatrix(args) {
  if (wantsHelp(args)) return printUsage("matrix");

  const outputPath = argValue(args, "--out");
  const markdownPath = argValue(args, "--markdown") || argValue(args, "--out-md");
  const inputPaths = positionalArgs(args, ["--out", "--markdown", "--out-md", "--require", "--require-capabilities"]);
  const requiredCapabilitiesRaw = argValue(args, "--require") || argValue(args, "--require-capabilities");
  const requiredCapabilities = requiredCapabilitiesRaw ? parseProbeChecks(requiredCapabilitiesRaw) : [];
  const failOnFail = args.includes("--fail-on-fail");
  const failOnWarn = args.includes("--fail-on-warn");
  const failOnRegression = args.includes("--fail-on-regression");

  if (inputPaths.length === 0) {
    console.error(commandUsage.matrix);
    return 2;
  }
  if (requiredCapabilitiesRaw && !requiredCapabilities) {
    console.error(`Unknown matrix required capability. Available values: all, basic, agent, ${availableProbeCheckCapabilities().join(", ")}`);
    return 2;
  }

  const expandedInputPaths = expandMatrixInputPaths(inputPaths, [outputPath, markdownPath].filter(Boolean));
  if (expandedInputPaths.length === 0) {
    console.error("matrix did not find any probe report JSON files.");
    return 2;
  }
  const missingInputPath = expandedInputPaths.find((inputPath) => !fs.existsSync(inputPath));
  if (missingInputPath) {
    console.error(`matrix input path does not exist: ${missingInputPath}`);
    return 2;
  }
  const invalidInput = findInvalidMatrixInput(expandedInputPaths);
  if (invalidInput) {
    console.error(invalidInput.message);
    return 2;
  }

  const matrix = buildProviderMatrix(expandedInputPaths, { failOnFail, failOnWarn, failOnRegression, requiredCapabilities });
  const markdown = renderProviderMatrixMarkdown(matrix);

  if (outputPath) {
    writeTextFile(outputPath, `${JSON.stringify(matrix, null, 2)}\n`);
    console.log(`[deepseek-compat-kit] wrote provider matrix: ${outputPath}`);
  }

  if (markdownPath) {
    writeTextFile(markdownPath, markdown);
    console.log(`[deepseek-compat-kit] wrote markdown provider matrix: ${markdownPath}`);
  }

  if (!outputPath && !markdownPath) {
    process.stdout.write(markdown);
  }

  if (failOnRegression && matrix.summary.regressed > 0) return 1;
  if (matrix.summary.required_failures > 0) return 1;
  if (failOnFail && matrix.summary.failed > 0) return 1;
  if (failOnWarn && (matrix.summary.warned > 0 || matrix.summary.failed > 0)) return 1;
  return 0;
}

function expandMatrixInputPaths(inputPaths, excludedPaths = []) {
  const excluded = new Set(excludedPaths.map((item) => path.resolve(item)));
  const expanded = [];
  for (const inputPath of inputPaths) {
    const resolved = path.resolve(inputPath);
    if (!fs.existsSync(resolved)) {
      expanded.push(inputPath);
      continue;
    }
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {
      if (!excluded.has(resolved)) expanded.push(inputPath);
      continue;
    }
    const children = fs.readdirSync(resolved)
      .filter((name) => name.toLowerCase().endsWith(".json"))
      .map((name) => path.join(resolved, name))
      .filter((childPath) => !excluded.has(path.resolve(childPath)))
      .filter((childPath) => isLikelyProbeReportPath(childPath))
      .sort((left, right) => left.localeCompare(right));
    expanded.push(...children);
  }
  return [...new Set(expanded.map((item) => path.resolve(item)))];
}

function isLikelyProbeReportPath(filePath) {
  try {
    const report = readJson(filePath);
    return Boolean(report?.summary?.capabilities);
  } catch {
    return false;
  }
}

function findInvalidMatrixInput(inputPaths) {
  for (const inputPath of inputPaths) {
    let report;
    try {
      report = readJson(inputPath);
    } catch (error) {
      return {
        inputPath,
        message: `matrix input is not a readable probe report JSON: ${inputPath}; ${error.message}`,
      };
    }
    if (!report?.summary?.capabilities) {
      return {
        inputPath,
        message: `matrix input is not a probe report JSON: ${inputPath}`,
      };
    }
  }
  return null;
}

function loadProbeBaselineForComparison(baselinePath) {
  if (!baselinePath) return null;
  if (!fs.existsSync(path.resolve(baselinePath))) {
    return { error: `probe baseline path does not exist: ${baselinePath}` };
  }
  let report;
  try {
    report = readJson(baselinePath);
  } catch (error) {
    return { error: `probe baseline is not a readable probe report JSON: ${baselinePath}; ${error.message}` };
  }
  if (!report?.summary?.capabilities) {
    return { error: `probe baseline is not a probe report JSON: ${baselinePath}` };
  }
  return { report };
}

function buildProviderMatrix(inputPaths, options = {}) {
  const reports = inputPaths.map((inputPath) => {
    const report = readJson(inputPath);
    const capabilities = report.summary?.capabilities || {};
    const normalizedCapabilities = {
      chat_completions: capabilities.chat_completions || "MISSING",
      streaming: capabilities.streaming || "MISSING",
      multi_turn_tool_messages: capabilities.multi_turn_tool_messages || "MISSING",
      strict_schema: capabilities.strict_schema || "MISSING",
    };
    const requiredFailures = (options.requiredCapabilities || [])
      .filter((capability) => normalizedCapabilities[capability] !== "PASS")
      .map((capability) => ({
        capability,
        status: normalizedCapabilities[capability] || "MISSING",
      }));

    return {
      source: inputPath,
      name: report.name || path.basename(inputPath),
      generated_at: report.generated_at || null,
      endpoint: report.endpoint || report.endpoint_input || "unknown",
      profile: report.profile || "unknown",
      model: report.model || "unknown",
      checks_requested: report.checks_requested || Object.keys(capabilities),
      status: report.summary?.status || "UNKNOWN",
      capabilities: normalizedCapabilities,
      required_failures: requiredFailures,
      baseline_status: report.baseline?.status || "none",
    };
  });

  const summary = {
    reports: reports.length,
    passed: reports.filter((report) => report.status === "PASS").length,
    warned: reports.filter((report) => report.status === "WARN").length,
    failed: reports.filter((report) => report.status === "FAIL").length,
    unknown: reports.filter((report) => !["PASS", "WARN", "FAIL"].includes(report.status)).length,
    regressed: reports.filter((report) => report.baseline_status === "REGRESSED").length,
    required_failures: reports.reduce((total, report) => total + report.required_failures.length, 0),
  };

  return {
    version: "0.1",
    generated_at: new Date().toISOString(),
    gate: {
      fail_on_fail: Boolean(options.failOnFail),
      fail_on_warn: Boolean(options.failOnWarn),
      fail_on_regression: Boolean(options.failOnRegression),
      required_capabilities: options.requiredCapabilities || [],
    },
    summary,
    reports,
  };
}

function renderProviderMatrixMarkdown(matrix) {
  const lines = [
    "# DeepSeek CompatKit Provider Matrix",
    "",
    `Generated: ${matrix.generated_at}`,
    "",
    "## Summary",
    "",
    `Reports: ${matrix.summary.reports}`,
    `Passed: ${matrix.summary.passed}`,
    `Warned: ${matrix.summary.warned}`,
    `Failed: ${matrix.summary.failed}`,
    `Unknown: ${matrix.summary.unknown}`,
    `Regressed: ${matrix.summary.regressed}`,
    `Required capability failures: ${matrix.summary.required_failures}`,
    "",
    "## Gate",
    "",
    `Fail on fail: ${matrix.gate.fail_on_fail ? "yes" : "no"}`,
    `Fail on warn: ${matrix.gate.fail_on_warn ? "yes" : "no"}`,
    `Fail on regression: ${matrix.gate.fail_on_regression ? "yes" : "no"}`,
    `Required capabilities: ${renderInlineCodeList(matrix.gate.required_capabilities)}`,
    "",
    "## Capability Matrix",
    "",
    "| Name | Endpoint | Profile | Model | Overall | Chat | Streaming | Multi-turn Tools | Strict Schema | Baseline |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];

  for (const report of matrix.reports) {
    lines.push([
      `\`${escapeMarkdownTable(report.name)}\``,
      `\`${escapeMarkdownTable(report.endpoint)}\``,
      `\`${escapeMarkdownTable(report.profile)}\``,
      `\`${escapeMarkdownTable(report.model)}\``,
      report.status,
      report.capabilities.chat_completions,
      report.capabilities.streaming,
      report.capabilities.multi_turn_tool_messages,
      report.capabilities.strict_schema,
      report.baseline_status,
    ].join(" | ").replace(/^/, "| ").replace(/$/, " |"));
  }

  const requiredFailures = matrix.reports.filter((report) => report.required_failures.length > 0);
  if (requiredFailures.length > 0) {
    lines.push("", "## Required Capability Failures", "");
    lines.push("| Name | Capability | Status |", "| --- | --- | --- |");
    for (const report of requiredFailures) {
      for (const failure of report.required_failures) {
        lines.push(`| \`${escapeMarkdownTable(report.name)}\` | \`${escapeMarkdownTable(failure.capability)}\` | ${failure.status} |`);
      }
    }
  }

  lines.push(
    "",
    "## Boundary",
    "",
    "- This matrix only summarizes probe reports that were explicitly provided to the command.",
    "- A PASS entry means the endpoint passed the small functional checks in that report, not a full benchmark or framework certification.",
    "- Keep the original JSON probe reports as the source of truth for issue triage and regression review.",
    "",
  );

  return `${lines.join("\n")}\n`;
}

function inventory(args) {
  if (wantsHelp(args)) return printUsage("inventory");

  const rootArg = argValue(args, "--path") || argValue(args, "-p") || firstPositional(args, [
    "--path",
    "-p",
    "--max-files",
    "--out",
    "--markdown",
    "--out-md",
  ]) || process.cwd();
  const outputPath = argValue(args, "--out");
  const markdownPath = argValue(args, "--markdown") || argValue(args, "--out-md");
  const maxFiles = positiveIntegerArg(args, "--max-files", 500);
  if (!maxFiles) {
    console.error("--max-files must be a positive integer.");
    return 2;
  }
  let report;
  try {
    report = buildInventoryReport(rootArg, { maxFiles });
  } catch (error) {
    console.error(error.message);
    return 2;
  }

  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (outputPath) {
    writeTextFile(outputPath, json);
    console.log(`[deepseek-compat-kit] wrote inventory report: ${outputPath}`);
  } else {
    process.stdout.write(json);
  }

  if (markdownPath) {
    writeTextFile(markdownPath, renderInventoryMarkdown(report));
    console.log(`[deepseek-compat-kit] wrote markdown inventory report: ${markdownPath}`);
  }

  return 0;
}

function buildInventoryReport(rootArg, options = {}) {
  const root = path.resolve(rootArg);
  if (!fs.existsSync(root)) {
    throw new Error(`Inventory path does not exist: ${root}`);
  }

  const maxFiles = options.maxFiles || 500;
  const report = createInventoryReport(root, { maxFiles });
  const { files, limitReached } = collectInventoryFiles(root, maxFiles);
  report.summary.files_scanned = files.length;
  report.summary.max_files = maxFiles;
  report.summary.scan_limit_reached = limitReached;

  for (const filePath of files) {
    inspectInventoryFile(filePath, root, report);
  }

  if (limitReached) {
    addInventoryFinding(report, {
      level: "WARN",
      code: "DSK_INV_SCAN_LIMIT",
      file: "",
      line: 0,
      message: `Inventory stopped after scanning ${maxFiles} candidate file(s). Re-run against a narrower --path for a complete report.`,
    });
  }

  summarizeInventory(report);
  return report;
}

function createInventoryReport(root, options = {}) {
  return {
    version: "0.1",
    generated_at: new Date().toISOString(),
    root,
    scope: "explicit local path only; no network calls; secret values are not recorded",
    summary: {
      files_scanned: 0,
      max_files: options.maxFiles || 500,
      scan_limit_reached: false,
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

function collectInventoryFiles(root, maxFiles = 500) {
  const files = [];
  const rootStat = fs.statSync(root);
  if (rootStat.isFile()) return { files: shouldScanInventoryFile(root) ? [root] : [], limitReached: false, maxFiles };

  const stack = [root];
  let limitReached = false;
  while (stack.length > 0) {
    if (files.length >= maxFiles) {
      limitReached = true;
      break;
    }

    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      if (files.length >= maxFiles) {
        limitReached = true;
        break;
      }

      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!shouldSkipInventoryDirectory(entry.name)) stack.push(fullPath);
        continue;
      }

      if (entry.isFile() && shouldScanInventoryFile(fullPath)) {
        files.push(fullPath);
        if (files.length >= maxFiles && (index < entries.length - 1 || stack.length > 0)) {
          limitReached = true;
          break;
        }
      }
    }
  }

  return { files, limitReached, maxFiles };
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

  if (/\bopenrouter\b/.test(lowered) || lowered.includes("openrouter.ai")) {
    targets.push({ name: "openrouter", reason: "OpenRouter relay reference detected." });
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
    if (isInventoryProviderUrlCandidate(url)) {
      urls.push(url);
    }
  }
  return [...new Set(urls)];
}

function isInventoryProviderUrlCandidate(url) {
  const lowered = String(url).toLowerCase();
  return lowered.includes("deepseek")
    || lowered.includes("openrouter.ai")
    || lowered.includes("127.0.0.1:8787")
    || lowered.includes("localhost:8787");
}

function extractInventoryModels(line) {
  return [...new Set(Array.from(line.matchAll(/\bdeepseek-[a-z0-9._-]+\b/gi), (match) => match[0]))];
}

function detectInventoryEnvSecret(line) {
  const match = line.match(/^\s*([A-Z_][A-Z0-9_]*(?:API_KEY|KEY|TOKEN|SECRET))\s*=\s*(.+?)\s*$/i);
  if (!match) return undefined;
  const variable = match[1];
  if (isLikelyPublicInventoryVariable(variable)) return undefined;
  const value = match[2].replace(/^['"]|['"]$/g, "").trim();
  if (!value || /^(your_|sk-\.\.\.|<|xxx|changeme|example|placeholder)/i.test(value)) return undefined;
  return variable;
}

function isLikelyPublicInventoryVariable(variable) {
  return /^(?:PUBLIC|VITE|NEXT_PUBLIC|NUXT_PUBLIC|EXPO_PUBLIC)_/i.test(variable);
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

  if (report.summary.scan_limit_reached) {
    recommendations.push({
      code: "DSK_REC_NARROW_INVENTORY_PATH",
      command: "npx deepseek-compat-kit inventory --path <narrower-project-or-config-dir>",
      message: "Inventory reached the scan file limit; re-run against a narrower path for a complete report.",
    });
  }

  if (hasInventorySecretWarnings(report)) {
    recommendations.push({
      code: "DSK_REC_REDACT_SECRETS",
      command: "Move API keys to environment variables or a local secret store before sharing reports.",
      message: "Potential secret assignments were detected; values were redacted from this report.",
    });
  }

  return recommendations;
}

function hasInventorySecretWarnings(report) {
  return report.findings.some((finding) => ["DSK_INV_SECRET_PRESENT", "DSK_INV_RAW_SECRET"].includes(finding.code));
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
    `Scan limit: ${report.summary.scan_limit_reached ? `reached (${report.summary.max_files} files)` : `not reached (${report.summary.max_files} files)`}`,
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
  if (wantsHelp(args)) return printUsage("recipes");

  const target = normalizeRecipeTarget(argValue(args, "--target") || firstPositional(args));
  if (!target) {
    console.log("[deepseek-compat-kit] available recipes:");
    console.log("- opencode: print-only DeepSeek/OpenAI-compatible baseURL recipe");
    console.log("- cline: print-only Cline OpenAI-compatible baseURL recipe");
    console.log("- roo-code: print-only legacy Roo Code OpenAI-compatible baseURL recipe");
    console.log("- openrouter: print-only OpenRouter relay header/probe recipe");
    console.log("- openai-js: print-only OpenAI JS SDK baseURL recipe");
    console.log("- langchain-js: print-only LangChain JS ChatOpenAI baseURL recipe");
    return 0;
  }

  const recipe = recipeFor(target);
  if (!recipe) {
    console.error(`Unknown recipe "${target}". Available recipes: opencode, cline, roo-code, openrouter, openai-js, langchain-js`);
    return 2;
  }

  process.stdout.write(`${recipe.markdown}\n`);
  return 0;
}

function doctor(args) {
  if (wantsHelp(args)) return printUsage("doctor");

  const target = normalizeRecipeTarget(argValue(args, "--target") || firstPositional(args, [
    "--target",
    "--path",
    "-p",
    "--max-files",
    "--markdown",
    "--out-md",
  ]));
  const rootArg = argValue(args, "--path") || argValue(args, "-p");
  const markdownPath = argValue(args, "--markdown") || argValue(args, "--out-md");
  const maxFiles = positiveIntegerArg(args, "--max-files", 500);
  if (!maxFiles) {
    console.error("--max-files must be a positive integer.");
    return 2;
  }
  if (!target) {
    console.error(commandUsage.doctor);
    return 2;
  }

  if (target === "auto") {
    if (!rootArg) {
      console.error("Usage: deepseek-compat-kit doctor --target auto --path <dir> [--max-files 500] [--markdown <doctor.md>] [--print]");
      return 2;
    }

    let inventoryReport;
    try {
      inventoryReport = buildInventoryReport(rootArg, { maxFiles });
    } catch (error) {
      console.error(error.message);
      return 2;
    }

    const recipes = inventoryReport.summary.detected_targets
      .map((detectedTarget) => recipeFor(detectedTarget))
      .filter(Boolean);
    const markdown = renderAutoDoctorMarkdown({ inventoryReport, recipes });
    if (markdownPath) {
      writeTextFile(markdownPath, markdown);
      console.log(`[deepseek-compat-kit] wrote doctor report: ${markdownPath}`);
    }

    if (!markdownPath || args.includes("--print")) {
      process.stdout.write(markdown);
    }

    return 0;
  }

  const recipe = recipeFor(target);
  if (!recipe) {
    console.error(`Unknown doctor target "${target}". Available targets: auto, opencode, cline, roo-code, openrouter, openai-js, langchain-js`);
    return 2;
  }

  let inventoryReport;
  if (rootArg) {
    try {
      inventoryReport = buildInventoryReport(rootArg, { maxFiles });
    } catch (error) {
      console.error(error.message);
      return 2;
    }
  }

  const markdown = renderDoctorMarkdown({ recipe, inventoryReport });
  if (markdownPath) {
    writeTextFile(markdownPath, markdown);
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
      `Scan limit: ${inventoryReport.summary.scan_limit_reached ? `reached (${inventoryReport.summary.max_files} files)` : `not reached (${inventoryReport.summary.max_files} files)`}`,
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
    `Scan limit: ${inventoryReport.summary.scan_limit_reached ? `reached (${inventoryReport.summary.max_files} files)` : `not reached (${inventoryReport.summary.max_files} files)`}`,
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
  if (["openrouter", "open-router", "open_router", "openrouter-ai"].includes(normalized)) return "openrouter";
  if (["openai-js", "openai_js", "openai", "openai-sdk", "openai-js-sdk"].includes(normalized)) return "openai-js";
  if (["langchain-js", "langchain_js", "langchain", "langchain-openai"].includes(normalized)) return "langchain-js";
  return normalized;
}

function recipeFor(target) {
  if (target === "opencode") return opencodeRecipe();
  if (target === "cline") return clineRecipe();
  if (target === "roo-code") return rooCodeRecipe();
  if (target === "openrouter") return openRouterRecipe();
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

function openRouterRecipe() {
  const markdown = [
    "# OpenRouter + DeepSeek CompatKit Recipe",
    "",
    "Use this when an OpenAI-compatible client, local proxy, or framework routes DeepSeek traffic through OpenRouter and you want a repeatable capability report before running a real Agent task.",
    "",
    "Safety boundary:",
    "- This recipe is print-only.",
    "- It does not edit OpenRouter, SDK, framework, or local proxy configuration files.",
    "- It treats OpenRouter as a relay provider. Passing this recipe is not proof that every model route or provider behind OpenRouter behaves identically.",
    "- Live OpenRouter end-to-end validation is pending.",
    "",
    "1. Put credentials and optional relay attribution in environment variables:",
    "",
    "```bash",
    "export OPENROUTER_API_KEY=sk-or-...",
    "export OPENROUTER_APP_URL=https://example.com",
    "export OPENROUTER_APP_TITLE=\"DeepSeek CompatKit Probe\"",
    "```",
    "",
    "2. Probe OpenRouter directly:",
    "",
    "```bash",
    "npx deepseek-compat-kit probe \\",
    "  --endpoint https://openrouter.ai/api/v1 \\",
    "  --name \"OpenRouter DeepSeek\" \\",
    "  --model deepseek/deepseek-chat \\",
    "  --profile relay \\",
    "  --api-key-env OPENROUTER_API_KEY \\",
    "  --header-env \"HTTP-Referer=OPENROUTER_APP_URL\" \\",
    "  --header-env \"X-Title=OPENROUTER_APP_TITLE\" \\",
    "  --out ./reports/openrouter-deepseek.json \\",
    "  --markdown ./reports/OpenRouter_DeepSeek.md",
    "```",
    "",
    "3. If you need the local proxy in the middle, start it with the same upstream route:",
    "",
    "```bash",
    "OPENROUTER_API_KEY=sk-or-... npx deepseek-compat-kit proxy \\",
    "  --port 8787 \\",
    "  --upstream https://openrouter.ai/api/v1 \\",
    "  --upstream-api-key-env OPENROUTER_API_KEY \\",
    "  --upstream-header-env \"HTTP-Referer=OPENROUTER_APP_URL\" \\",
    "  --upstream-header-env \"X-Title=OPENROUTER_APP_TITLE\"",
    "```",
    "",
    "Then point your OpenAI-compatible client at:",
    "",
    "```text",
    "http://127.0.0.1:8787/v1",
    "```",
    "",
    "4. Compare OpenRouter with other endpoints:",
    "",
    "```bash",
    "npx deepseek-compat-kit matrix ./reports --require agent --markdown ./Provider_Matrix.md",
    "```",
    "",
    "Troubleshooting:",
    "- If `chat_completions` fails, confirm the model route and whether your OpenRouter account can access it.",
    "- If `strict_schema` warns, compare the same request against the official DeepSeek endpoint before changing application code.",
    "- If streaming warns, try a non-streaming Agent run first and keep the JSON probe report for provider triage.",
  ].join("\n");

  return {
    title: "OpenRouter",
    markdown,
  };
}

function lintSchema(args) {
  if (wantsHelp(args)) return printUsage("lint-schema");

  const filePath = firstPositional(args, ["--base-url"]);
  if (!filePath) {
    console.error(commandUsage["lint-schema"]);
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
  if (wantsHelp(args)) return printUsage("diagnose");

  const filePath = firstPositional(args, ["--out", "--markdown", "--out-md"]);
  const outputPath = argValue(args, "--out");
  const markdownPath = argValue(args, "--markdown") || argValue(args, "--out-md");
  const failOnWarn = args.includes("--fail-on-warn");
  if (!filePath) {
    console.error(commandUsage.diagnose);
    return 2;
  }

  const events = readJsonl(filePath);
  const findings = diagnoseEvents(events);
  const report = createDiagnoseReport({ filePath, events, findings, failOnWarn });
  if (outputPath) {
    writeTextFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`[deepseek-compat-kit] wrote diagnose JSON report: ${outputPath}`);
  }
  if (markdownPath) {
    writeTextFile(markdownPath, renderDiagnoseMarkdown(report));
    console.log(`[deepseek-compat-kit] wrote diagnose markdown report: ${markdownPath}`);
  }

  if (findings.length === 0) {
    console.log("[deepseek-compat-kit] no known DeepSeek V4 compatibility failures detected");
    return 0;
  }

  for (const finding of findings) {
    console.log(`${finding.level} ${finding.code} ${finding.path}: ${finding.message}`);
  }

  return report.gate.failed ? 1 : 0;
}

function createDiagnoseReport({ filePath, events, findings, failOnWarn = false }) {
  const summary = summarizeDiagnoseEvents(events);
  const hasErrors = findings.some((finding) => finding.level === "ERROR");
  const hasWarnings = findings.some((finding) => finding.level === "WARN");
  return {
    tool: "deepseek-compat-kit",
    report_type: "diagnose",
    source: filePath,
    generated_at: new Date().toISOString(),
    summary: {
      status: hasErrors ? "FAIL" : findings.length > 0 ? "WARN" : "PASS",
      events: events.length,
      requests: summary.requests,
      responses: summary.responses,
      assistant_tool_call_messages: summary.assistantToolCallMessages,
      assistant_messages_with_reasoning_content: summary.assistantReasoningMessages,
      findings: findings.length,
    },
    gate: {
      fail_on_warn: Boolean(failOnWarn),
      failed: hasErrors || (failOnWarn && hasWarnings),
    },
    findings: findings.map(summarizeFinding),
    next_steps: diagnoseNextSteps(findings),
    privacy_notes: [
      "This report is derived from structural JSONL events.",
      "Do not attach raw application logs containing API keys, prompt text, private tool results, or full reasoning bodies.",
    ],
  };
}

function renderDiagnoseMarkdown(report) {
  const lines = [
    "# DeepSeek CompatKit Diagnose Report",
    "",
    `Source: \`${escapeMarkdownTable(report.source)}\``,
    `Generated: \`${report.generated_at}\``,
    "",
    "## Summary",
    "",
    `- Status: ${report.summary.status}`,
    `- Events: ${report.summary.events}`,
    `- Requests: ${report.summary.requests}`,
    `- Responses: ${report.summary.responses}`,
    `- Assistant tool-call messages: ${report.summary.assistant_tool_call_messages}`,
    `- Assistant messages with reasoning_content: ${report.summary.assistant_messages_with_reasoning_content}`,
    `- Findings: ${report.summary.findings}`,
    `- Fail on warn: ${report.gate.fail_on_warn ? "yes" : "no"}`,
    `- Gate failed: ${report.gate.failed ? "yes" : "no"}`,
    "",
  ];

  if (report.findings.length === 0) {
    lines.push("No known DeepSeek V4 compatibility failures were detected.", "");
  } else {
    lines.push("## Findings", "");
    lines.push("| Level | Code | Path | Message |");
    lines.push("| --- | --- | --- | --- |");
    for (const finding of report.findings) {
      lines.push(`| ${finding.level} | \`${escapeMarkdownTable(finding.code)}\` | \`${escapeMarkdownTable(finding.path)}\` | ${escapeMarkdownTable(finding.message)} |`);
    }
    lines.push("");
  }

  lines.push("## Next Steps", "");
  for (const step of report.next_steps) lines.push(`- ${step}`);
  lines.push("");
  lines.push("## Privacy Notes", "");
  for (const note of report.privacy_notes) lines.push(`- ${note}`);
  lines.push("");

  return `${lines.join("\n")}\n`;
}

function diagnoseNextSteps(findings) {
  if (findings.some((finding) => finding.code === "DSK_REASONING_001")) {
    return [
      "Preserve `reasoning_content` on assistant tool-call messages when sending follow-up tool results.",
      "If using the local proxy, route the whole conversation through the proxy from turn one.",
      "If this came from `proxy --diagnostics-log`, attach this Markdown report plus the sanitized JSONL when opening an upstream issue.",
    ];
  }
  return [
    "If the issue still reproduces, capture a fresh run with `proxy --diagnostics-log ./logs/proxy.jsonl`.",
    "Run `probe` against the same endpoint to separate framework behavior from provider behavior.",
  ];
}

function summarizeDiagnoseEvents(events) {
  const summary = {
    requests: 0,
    responses: 0,
    assistantToolCallMessages: 0,
    assistantReasoningMessages: 0,
  };

  for (const event of events) {
    if (event?.type === "request") summary.requests += 1;
    if (event?.type === "response") summary.responses += 1;

    const messages = Array.isArray(event?.messages)
      ? event.messages
      : event?.message
        ? [event.message]
        : [];
    for (const message of messages) {
      if (message?.role === "assistant" && Array.isArray(message.tool_calls)) summary.assistantToolCallMessages += 1;
      if (message?.role === "assistant" && message.reasoning_content) summary.assistantReasoningMessages += 1;
    }
  }

  return summary;
}

function diagnoseEvents(events) {
  const findings = [];
  const reasoningByToolCall = new Map();

  events.forEach((event, eventIndex) => {
    findings.push(...extractEmbeddedDiagnosticFindings(event, eventIndex));

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

function extractEmbeddedDiagnosticFindings(event, eventIndex) {
  const findings = [];
  const groups = [
    ["repair.findings", event?.repair?.findings],
    ["schema_findings", event?.schema_findings],
  ];

  for (const [label, items] of groups) {
    if (!Array.isArray(items)) continue;
    items.forEach((item, itemIndex) => {
      if (!item?.code || !item?.message) return;
      findings.push({
        level: item.level || "WARN",
        code: item.code,
        path: `events[${eventIndex}].${label}[${itemIndex}]${item.path ? ` ${item.path}` : ""}`,
        message: item.message,
      });
    });
  }

  return findings;
}

function sanitize(args) {
  if (wantsHelp(args)) return printUsage("sanitize");

  const inputPath = firstPositional(args, ["--out"]);
  const outputPath = argValue(args, "--out");
  if (!inputPath || !outputPath) {
    console.error(commandUsage.sanitize);
    return 2;
  }

  const events = readJsonl(inputPath);
  const sanitized = events.map((event) => sanitizeValue(event, { role: undefined, key: undefined }));
  writeTextFile(outputPath, `${sanitized.map((event) => JSON.stringify(event)).join("\n")}\n`);
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
  if (wantsHelp(args)) return printUsage("proxy");

  const port = argValue(args, "--port") || "8787";
  const upstream = normalizeBaseUrl(argValue(args, "--upstream") || process.env.DEEPSEEK_COMPAT_UPSTREAM || "https://api.deepseek.com");
  const upstreamApiKeyEnv = argValue(args, "--upstream-api-key-env") || "DEEPSEEK_API_KEY";
  const upstreamApiKey = upstreamApiKeyEnv ? process.env[upstreamApiKeyEnv] : "";
  const upstreamTimeoutMsRaw = argValue(args, "--upstream-timeout-ms") || process.env.DEEPSEEK_COMPAT_UPSTREAM_TIMEOUT_MS || "30000";
  const upstreamTimeoutMs = Number(upstreamTimeoutMsRaw);
  const stateTtlMsRaw = argValue(args, "--state-ttl-ms") || process.env.DEEPSEEK_COMPAT_STATE_TTL_MS || "3600000";
  const stateTtlMs = Number(stateTtlMsRaw);
  const diagnosticsLogPath = argValue(args, "--diagnostics-log") || process.env.DEEPSEEK_COMPAT_DIAGNOSTICS_LOG || "";
  const literalUpstreamHeaders = parseProbeHeaders(argValues(args, "--upstream-header"));
  const envUpstreamHeaders = parseProbeHeaderEnvs(argValues(args, "--upstream-header-env"), process.env);
  if (!Number.isInteger(upstreamTimeoutMs) || upstreamTimeoutMs <= 0) {
    console.error("--upstream-timeout-ms must be a positive integer.");
    return 2;
  }
  if (!Number.isInteger(stateTtlMs) || stateTtlMs <= 0) {
    console.error("--state-ttl-ms must be a positive integer.");
    return 2;
  }
  if (!literalUpstreamHeaders) {
    console.error("--upstream-header must use the form \"Name: Value\" and valid HTTP token header names.");
    return 2;
  }
  if (envUpstreamHeaders.error) {
    console.error(envUpstreamHeaders.error.replace(/--header-env/g, "--upstream-header-env"));
    return 2;
  }
  if (diagnosticsLogPath) {
    fs.mkdirSync(path.dirname(path.resolve(diagnosticsLogPath)), { recursive: true });
    fs.appendFileSync(path.resolve(diagnosticsLogPath), "");
  }
  const upstreamHeaders = { ...envUpstreamHeaders.headers, ...literalUpstreamHeaders };
  const state = createProxyState({ stateTtlMs });
  const server = http.createServer((request, response) => {
    handleProxyRequest({ request, response, upstream, state, upstreamHeaders, upstreamApiKey, upstreamApiKeyEnv, upstreamTimeoutMs, diagnosticsLogPath }).catch((error) => {
      console.error(`[deepseek-compat-kit] proxy error: ${error.message}`);
      if (!response.headersSent) {
        response.writeHead(502, { "content-type": "application/json" });
      }
      response.end(JSON.stringify({ error: { message: "DeepSeek CompatKit proxy failed", detail: error.message } }));
    });
  });

  server.listen(Number(port), "127.0.0.1", () => {
    console.error(`[deepseek-compat-kit] proxy listening on http://127.0.0.1:${port}/v1`);
    console.error(`[deepseek-compat-kit] upstream: ${upstream}`);
    console.error(`[deepseek-compat-kit] upstream api key env: ${upstreamApiKeyEnv || "none"} (${upstreamApiKey ? "present" : "not set"})`);
    console.error(`[deepseek-compat-kit] upstream response timeout: ${upstreamTimeoutMs} ms`);
    console.error(`[deepseek-compat-kit] reasoning state ttl: ${stateTtlMs} ms`);
    if (Object.keys(upstreamHeaders).length > 0) {
      console.error(`[deepseek-compat-kit] upstream extra headers: ${Object.keys(upstreamHeaders).join(", ")}`);
    }
    if (diagnosticsLogPath) {
      console.error(`[deepseek-compat-kit] diagnostics log: ${diagnosticsLogPath}`);
    }
    console.error("[deepseek-compat-kit] boundary: reasoning_content repair is stateful conservative, not stateless magic.");
  });

  return undefined;
}

function createProxyState({ stateTtlMs = 3600000 } = {}) {
  return {
    reasoningByToolCallId: new Map(),
    maxEntries: 2000,
    stateTtlMs,
    nextSourceTurnId: 0,
  };
}

async function handleProxyRequest({ request, response, upstream, state, upstreamHeaders = {}, upstreamApiKey = "", upstreamApiKeyEnv = "DEEPSEEK_API_KEY", upstreamTimeoutMs = 30000, diagnosticsLogPath = "" }) {
  if (request.method === "GET" && request.url === "/health") {
    pruneProxyState(state);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      ok: true,
      name: "deepseek-compat-kit",
      mode: "proxy-alpha",
      upstream,
      upstream_api_key_env: upstreamApiKeyEnv || "none",
      upstream_api_key_present: Boolean(upstreamApiKey),
      upstream_response_timeout_ms: upstreamTimeoutMs,
      upstream_extra_header_names: Object.keys(upstreamHeaders),
      reasoning_state: {
        cache_entries: state.reasoningByToolCallId.size,
        max_entries: state.maxEntries,
        ttl_ms: state.stateTtlMs,
      },
    }));
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
  appendProxyDiagnostics(diagnosticsLogPath, summarizeProxyRequestEvent({
    body,
    pathname,
    repair,
    schemaFindings,
  }));

  for (const finding of [...repair.findings, ...schemaFindings]) {
    console.error(`${finding.level} ${finding.code} ${finding.path}: ${finding.message}`);
  }

  const upstreamPath = pathname === "/v1/chat/completions" ? "/chat/completions" : pathname;
  const upstreamUrl = `${upstream}${upstreamPath}${requestUrl.search}`;
  const upstreamResponse = await fetchProxyUpstream(upstreamUrl, {
    method: "POST",
    headers: buildUpstreamHeaders(request.headers, body, upstreamHeaders, upstreamApiKey, upstreamApiKeyEnv),
    body: JSON.stringify(body),
  }, upstreamTimeoutMs);

  response.writeHead(upstreamResponse.status, buildResponseHeaders(upstreamResponse.headers, repair, schemaFindings));

  const contentType = upstreamResponse.headers.get("content-type") || "";
  if (body.stream || contentType.includes("text/event-stream")) {
    const streamState = await pipeStreamingResponse(upstreamResponse, response, state);
    appendProxyDiagnostics(diagnosticsLogPath, ...summarizeStreamingResponseEvents({
      status: upstreamResponse.status,
      contentType,
      streamState,
      state,
    }));
    return;
  }

  const text = await upstreamResponse.text();
  rememberNonStreamingResponse(text, state);
  appendProxyDiagnostics(diagnosticsLogPath, ...summarizeNonStreamingResponseEvents({
    status: upstreamResponse.status,
    contentType,
    text,
    state,
  }));
  response.end(text);
}

async function fetchProxyUpstream(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`upstream did not respond within ${timeoutMs} ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
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
  pruneProxyState(state);
  if (!Array.isArray(body.messages)) return { injected, findings };

  body.messages.forEach((message, messageIndex) => {
    if (message?.role !== "assistant" || !Array.isArray(message.tool_calls) || message.reasoning_content) return;
    const toolCallIds = message.tool_calls.map((call) => call?.id).filter(Boolean);
    const missingIdCount = message.tool_calls.length - toolCallIds.length;
    const cached = message.tool_calls
      .map((call) => call?.id && state.reasoningByToolCallId.get(call.id))
      .filter(Boolean);
    if (cached.length === 0) {
      if (toolCallIds.length > 0 || missingIdCount > 0) {
        const missingDetails = [
          ...toolCallIds,
          ...(missingIdCount > 0 ? [`${missingIdCount} tool call(s) without id`] : []),
        ];
        findings.push(warn(
          "DSK_REASONING_002",
          `messages[${messageIndex}]`,
          `no cached reasoning_content was available for ${missingDetails.join(", ")}. Route the whole conversation through the proxy from turn one and keep state within the configured TTL.`,
        ));
      }
      return;
    }

    const missingIds = toolCallIds.filter((id) => !state.reasoningByToolCallId.has(id));
    if (missingIds.length > 0 || missingIdCount > 0) {
      const missingDetails = [
        ...missingIds,
        ...(missingIdCount > 0 ? [`${missingIdCount} tool call(s) without id`] : []),
      ];
      findings.push(error(
        "DSK_REASONING_002",
        `messages[${messageIndex}]`,
        `some tool calls have no cached reasoning_content: ${missingDetails.join(", ")}. The proxy cannot reconstruct content it never saw.`,
      ));
      return;
    }

    const sourceTurnIds = [...new Set(cached.map((entry) => entry.sourceTurnId).filter(Boolean))];
    if (sourceTurnIds.length > 1) {
      findings.push(error(
        "DSK_REASONING_004",
        `messages[${messageIndex}]`,
        "cached reasoning_content came from multiple assistant turns. Refused to restore it to avoid cross-turn or cross-session mixing.",
      ));
      return;
    }

    const uniqueReasoning = [...new Set(cached.map((entry) => entry.reasoningContent))];
    message.reasoning_content = uniqueReasoning.join("\n");
    injected += 1;
    findings.push(warn(
      "DSK_REASONING_003",
      `messages[${messageIndex}]`,
      `restored cached reasoning_content for ${cached.length} tool call(s).`,
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

function buildUpstreamHeaders(headers, body, extraHeaders = {}, upstreamApiKey = "", _upstreamApiKeyEnv = "DEEPSEEK_API_KEY") {
  const output = {
    "content-type": "application/json",
    "accept": firstHeader(headers.accept) || "application/json",
    "user-agent": "deepseek-compat-kit/0.1",
    ...extraHeaders,
  };

  const authorization = firstHeader(headers.authorization);
  if (authorization) output.authorization = authorization;
  if (!output.authorization && upstreamApiKey) output.authorization = `Bearer ${upstreamApiKey}`;
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
  return streamState;
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
    const sourceTurnId = nextProxySourceTurnId(state);
    for (const id of current.toolCallIds.values()) {
      rememberReasoning(id, current.reasoning, state, sourceTurnId);
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
    const sourceTurnId = nextProxySourceTurnId(state);
    for (const call of message.tool_calls) {
      if (call?.id) rememberReasoning(call.id, message.reasoning_content, state, sourceTurnId);
    }
  }
}

function nextProxySourceTurnId(state) {
  state.nextSourceTurnId += 1;
  return `turn_${state.nextSourceTurnId}`;
}

function rememberReasoning(toolCallId, reasoningContent, state, sourceTurnId) {
  pruneProxyState(state);
  state.reasoningByToolCallId.set(toolCallId, {
    reasoningContent,
    sourceTurnId,
    seenAt: Date.now(),
  });

  while (state.reasoningByToolCallId.size > state.maxEntries) {
    const oldest = state.reasoningByToolCallId.keys().next().value;
    state.reasoningByToolCallId.delete(oldest);
  }
}

function pruneProxyState(state) {
  const cutoff = Date.now() - state.stateTtlMs;
  for (const [toolCallId, entry] of state.reasoningByToolCallId.entries()) {
    if (entry.seenAt < cutoff) state.reasoningByToolCallId.delete(toolCallId);
  }
}

function appendProxyDiagnostics(filePath, ...events) {
  if (!filePath || events.length === 0) return;
  const lines = events
    .filter(Boolean)
    .map((event) => JSON.stringify(event));
  if (lines.length === 0) return;
  fs.appendFileSync(path.resolve(filePath), `${lines.join("\n")}\n`);
}

function summarizeProxyRequestEvent({ body, pathname, repair, schemaFindings }) {
  return {
    type: "request",
    timestamp: new Date().toISOString(),
    source: "proxy",
    path: pathname,
    model: sanitizeScalar(body?.model || ""),
    stream: Boolean(body?.stream),
    messages: summarizeDiagnosticMessages(body?.messages),
    tools_count: Array.isArray(body?.tools) ? body.tools.length : 0,
    repair: {
      reasoning_restored: repair.injected,
      findings: repair.findings.map(summarizeFinding),
    },
    schema_findings: schemaFindings.map(summarizeFinding),
  };
}

function summarizeNonStreamingResponseEvents({ status, contentType, text, state }) {
  const base = {
    timestamp: new Date().toISOString(),
    source: "proxy",
    status,
    content_type: contentType,
    reasoning_state: {
      cache_entries: state.reasoningByToolCallId.size,
      ttl_ms: state.stateTtlMs,
    },
  };
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    return [{ type: "response", ...base, parse_status: "non_json" }];
  }

  const events = [];
  for (const choice of payload?.choices || []) {
    const message = summarizeDiagnosticMessage(payloadChoiceMessage(choice));
    if (!message) continue;
    events.push({ type: "response", ...base, message });
  }
  return events.length > 0 ? events : [{ type: "response", ...base, parse_status: "no_message" }];
}

function summarizeStreamingResponseEvents({ status, contentType, streamState, state }) {
  const events = [];
  for (const current of streamState.values()) {
    if (current.toolCallIds.size === 0 && !current.reasoning) continue;
    events.push({
      type: "response",
      timestamp: new Date().toISOString(),
      source: "proxy",
      status,
      content_type: contentType,
      stream: true,
      message: {
        role: "assistant",
        reasoning_content: current.reasoning ? redactedSummary("reasoning_content", current.reasoning) : undefined,
        tool_calls: [...current.toolCallIds.values()].map((id) => ({ id, type: "function" })),
      },
      reasoning_state: {
        cache_entries: state.reasoningByToolCallId.size,
        ttl_ms: state.stateTtlMs,
      },
    });
  }
  return events;
}

function payloadChoiceMessage(choice) {
  return choice?.message || choice?.delta;
}

function summarizeDiagnosticMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages.map(summarizeDiagnosticMessage).filter(Boolean);
}

function summarizeDiagnosticMessage(message) {
  if (!message || typeof message !== "object") return undefined;
  const output = { role: message.role || "unknown" };
  if (message.reasoning_content) {
    output.reasoning_content = redactedSummary("reasoning_content", message.reasoning_content);
  }
  if (Array.isArray(message.tool_calls)) {
    output.tool_calls = message.tool_calls.map(summarizeDiagnosticToolCall).filter(Boolean);
  }
  if (message.role === "tool") {
    output.tool_call_id = message.tool_call_id;
    if (message.content) output.content = redactedSummary("tool_result", message.content);
  }
  return output;
}

function summarizeDiagnosticToolCall(call) {
  if (!call || typeof call !== "object") return undefined;
  return {
    id: call.id,
    type: call.type,
    function: call.function?.name ? { name: sanitizeScalar(call.function.name) } : undefined,
  };
}

function summarizeFinding(finding) {
  return {
    level: finding.level,
    code: finding.code,
    path: finding.path,
    message: sanitizeScalar(finding.message),
  };
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
