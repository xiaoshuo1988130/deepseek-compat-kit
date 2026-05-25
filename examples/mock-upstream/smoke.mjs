import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const mockPort = await freePort();
const proxyPort = await freePort();
const mockUrl = `http://127.0.0.1:${mockPort}`;
const proxyUrl = `http://127.0.0.1:${proxyPort}/v1/chat/completions`;

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
    waitForOutput(proxy.stderr, /proxy alpha listening/),
  ]);

  const first = await postJson(proxyUrl, {
    model: "mock-deepseek-reasoner",
    messages: [{ role: "user", content: "What is the weather?" }],
  });
  assert.equal(first.status, 200);
  assert.equal(first.body.choices[0].message.tool_calls[0].id, "call_mock_weather");
  console.log("[mock-demo] first turn ok");

  const second = await postJson(proxyUrl, {
    model: "mock-deepseek-reasoner",
    messages: [{
      role: "assistant",
      tool_calls: [{
        id: "call_mock_weather",
        type: "function",
        function: {
          name: "get_weather",
          arguments: "{\"city\":\"Shanghai\"}",
        },
      }],
    }],
  });
  assert.equal(second.status, 200);
  assert.equal(second.headers.get("x-deepseek-compat-reasoning-injected"), "1");
  assert.equal(second.body.mock.received_reasoning_content, true);
  console.log("[mock-demo] second turn ok");
  console.log(`[mock-demo] proxy injected reasoning_content: ${second.body.mock.received_reasoning_content}`);
} finally {
  proxy.kill();
  mock.kill();
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    headers: response.headers,
    body: await response.json(),
  };
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

