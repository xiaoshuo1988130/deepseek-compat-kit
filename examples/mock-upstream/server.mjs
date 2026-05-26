import http from "node:http";

const port = Number(argValue("--port") || process.env.PORT || 9000);
const requests = [];

const server = http.createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    writeJson(response, 200, { ok: true });
    return;
  }

  const pathname = new URL(request.url, "http://127.0.0.1").pathname;
  if (request.method !== "POST" || pathname !== "/chat/completions") {
    writeJson(response, 404, { error: { message: "mock only supports POST /chat/completions" } });
    return;
  }

  const body = await readJson(request);
  requests.push(body);

  if (body.stream) {
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write(`data: ${JSON.stringify({
      choices: [{
        index: 0,
        delta: { content: "ok" },
        finish_reason: null,
      }],
    })}\n\n`);
    response.write("data: [DONE]\n\n");
    response.end();
    return;
  }

  if (Array.isArray(body.tools)) {
    writeJson(response, 200, {
      id: "mock-strict-schema",
      object: "chat.completion",
      choices: [{
        index: 0,
        message: {
          role: "assistant",
          tool_calls: [{
            id: "call_mock_query",
            type: "function",
            function: {
              name: "record_query",
              arguments: "{\"query\":\"compatibility\"}",
            },
          }],
        },
        finish_reason: "tool_calls",
      }],
    });
    return;
  }

  if (body.messages?.[0]?.content === "Reply with exactly: ok") {
    writeJson(response, 200, {
      id: "mock-probe-chat",
      object: "chat.completion",
      choices: [{
        index: 0,
        message: { role: "assistant", content: "ok" },
        finish_reason: "stop",
      }],
    });
    return;
  }

  if (requests.length === 1) {
    writeJson(response, 200, {
      id: "mock-turn-1",
      object: "chat.completion",
      choices: [{
        index: 0,
        message: {
          role: "assistant",
          reasoning_content: "mock reasoning that must be preserved for follow-up tool calls",
          tool_calls: [{
            id: "call_mock_weather",
            type: "function",
            function: {
              name: "get_weather",
              arguments: "{\"city\":\"Shanghai\"}",
            },
          }],
        },
        finish_reason: "tool_calls",
      }],
    });
    return;
  }

  const assistantMessage = body.messages?.find((message) => message.role === "assistant" && Array.isArray(message.tool_calls));
  const receivedReasoning = Boolean(assistantMessage?.reasoning_content);
  writeJson(response, 200, {
    id: "mock-turn-2",
    object: "chat.completion",
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: receivedReasoning
          ? "mock upstream received repaired reasoning_content"
          : "mock upstream did not receive reasoning_content",
      },
      finish_reason: "stop",
    }],
    mock: {
      received_reasoning_content: receivedReasoning,
      reasoning_content_length: assistantMessage?.reasoning_content?.length || 0,
    },
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`[mock-upstream] listening on http://127.0.0.1:${port}`);
});

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function readJson(request) {
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

function writeJson(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(payload, null, 2));
}
