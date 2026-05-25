# Known Failures

This page tracks common DeepSeek V4 tool-calling migration failures and their diagnostic status.

## DSK_REASONING_001

The next request dropped `reasoning_content` after an assistant tool-call response.

Common user-facing error:

```text
The reasoning_content in the thinking mode must be passed back to the API
```

Initial action:

```bash
npx deepseek-compat-kit diagnose ./logs/deepseek-run.jsonl
```

## DSK_SCHEMA_002

Strict mode is being used without the DeepSeek beta base URL.

Expected base URL:

```text
https://api.deepseek.com/beta
```

## DSK_SCHEMA_003

An object schema has properties that are not all listed in `required`.

## DSK_SCHEMA_004

An object schema is missing `additionalProperties: false`.
