# OpenAI JS SDK Example

This example shows the intended zero-invasive path: keep your existing OpenAI-compatible client code, and change only `baseURL`.

## Run

Terminal 1:

```bash
DEEPSEEK_API_KEY=sk-... npx deepseek-compat-kit proxy --port 8787
```

Terminal 2:

```bash
cd examples/openai-js
npm install
DEEPSEEK_API_KEY=sk-... DEEPSEEK_MODEL=your-deepseek-model npm start
```

## Key line

```js
baseURL: "http://127.0.0.1:8787/v1"
```

The proxy forwards the request to DeepSeek, watches the response for `reasoning_content`, and can inject cached state into later tool-call turns when an upstream framework drops it.

