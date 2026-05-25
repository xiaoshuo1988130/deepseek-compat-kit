# curl Proxy Smoke Test

Start the proxy:

```bash
DEEPSEEK_API_KEY=sk-... npx deepseek-compat-kit proxy --port 8787
```

Send a minimal chat completion request:

```bash
curl http://127.0.0.1:8787/v1/chat/completions \
  -H "content-type: application/json" \
  -H "authorization: Bearer $DEEPSEEK_API_KEY" \
  -d '{
    "model": "'"$DEEPSEEK_MODEL"'",
    "messages": [
      { "role": "user", "content": "Say hello in one short sentence." }
    ]
  }'
```

For deterministic local proxy testing, point `--upstream` at a local mock server instead of the DeepSeek API.

