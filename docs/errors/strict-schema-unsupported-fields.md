# DeepSeek Strict Schema Compatibility

DeepSeek strict mode has schema constraints that differ from many Zod, Pydantic, and generic JSON Schema outputs.

## First-Class Checks

DeepSeek CompatKit should lint these as first-class rules:

- Strict mode must use the beta base URL: `https://api.deepseek.com/beta`.
- Every object property must be listed in `required`.
- Object schemas must set `additionalProperties: false`.
- Unsupported or risky fields should be flagged, including `minLength`, `maxLength`, `minItems`, and `maxItems`.
- Supported constraint keywords such as `pattern`, `format`, `minimum`, `maximum`, and `multipleOf` should not be reported as unsupported.

## Example Diagnostics

```text
ERROR DSK_SCHEMA_002: strict mode requires beta base URL: https://api.deepseek.com/beta.
ERROR DSK_SCHEMA_003: all object properties must be listed in required.
ERROR DSK_SCHEMA_004: object schemas must set additionalProperties: false.
```

## Repair Policy

Automatic repair must be explicit and auditable. A schema repair that removes constraints is not equivalent to the original schema. Removed constraints should become a post-validation requirement in application code.

Use `compile-schema` to generate a DeepSeek strict-mode compatible schema and a loss report:

```bash
npx deepseek-compat-kit compile-schema -i ./tools.schema.json -o ./deepseek.tools.schema.json --report ./deepseek.schema.report.json
```

The compiler will:

- remove unsupported constraints such as `minLength`, `maxLength`, `minItems`, and `maxItems`;
- add missing `required` entries for object properties;
- set `additionalProperties: false` on object schemas;
- emit a `system_prompt_appendix` and `post_validation_plan` for constraints that need application-level validation.
