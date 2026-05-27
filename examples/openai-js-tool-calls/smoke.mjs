import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const mockPort = await freePort();
const proxyPort = await freePort();
const mockUrl = `http://127.0.0.1:${mockPort}`;

const mock = spawn(process.execPath, [path.join(root, "examples/mock-upstream/server.mjs"), "--port", String(mockPort)], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"],
});
const proxy = spawn(process.execPath, [path.join(root, "bin/deepseek-compat-kit.js"), "proxy", "--port", String(proxyPort), "--upstream", mockUrl], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"],
});

try {
  await Promise.all([
    waitForOutput(mock.stdout, /mock-upstream.*listening/),
    waitForOutput(proxy.stderr, /proxy listening/),
  ]);

  const client = new OpenAI({
    apiKey: "mock-key",
    baseURL: `http://127.0.0.1:${proxyPort}/v1`,
  });

  const tools = [{
    type: "function",
    function: {
      name: "get_weather",
      description: "Get the current weather for a city.",
      parameters: {
        type: "object",
        properties: {
          city: { type: "string" },
        },
        required: ["city"],
        additionalProperties: false,
      },
    },
  }];

  const first = await client.chat.completions.create({
    model: "mock-deepseek-reasoner",
    messages: [{ role: "user", content: "What is the weather in Shanghai?" }],
    tools,
  });

  const assistantMessage = first.choices[0].message;
  const toolCallId = assistantMessage.tool_calls?.[0]?.id;
  assert.equal(toolCallId, "call_mock_weather");
  console.log(`[openai-js-tool-calls] first turn tool call: ${toolCallId}`);

  const brokenAssistantMessage = {
    role: assistantMessage.role,
    tool_calls: assistantMessage.tool_calls,
  };
  console.log("[openai-js-tool-calls] intentionally dropped reasoning_content before turn 2");

  const second = await client.chat.completions.create({
    model: "mock-deepseek-reasoner",
    messages: [
      { role: "user", content: "What is the weather in Shanghai?" },
      brokenAssistantMessage,
      {
        role: "tool",
        tool_call_id: toolCallId,
        content: JSON.stringify({ city: "Shanghai", weather: "sunny" }),
      },
    ],
    tools,
  });

  assert.equal(second.choices[0].message.content, "mock upstream received repaired reasoning_content");
  console.log(`[openai-js-tool-calls] final: ${second.choices[0].message.content}`);
  console.log("[openai-js-tool-calls] proxy injected reasoning_content: true");
} finally {
  proxy.kill();
  mock.kill();
}

async function freePort() {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
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

