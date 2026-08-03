# @shipfox/api-secrets

`@shipfox/api-secrets` stores workspace secrets and variables for backend modules.

## What it does

- **`secretsModule`**: Declares the module name and database migrations for the API module loader.
- **Secret store API**: `setSecrets`, `getSecret`, `getSecretsByNamespace`, and `deleteSecrets` manage encrypted values by scope and namespace.
- **Variable store API**: `setVariables`, `getVariable`, `getVariablesByNamespace`, and `deleteVariables` manage non-secret config values with the same scope rules.
- **`rotateWorkspaceDataKeys()`**: Re-wraps workspace data keys under the current KEK. It does not re-encrypt stored values.
- **Store resolver**: `resolveSecretStore` supports the built-in `local` store and rejects unknown store names with `UnknownSecretStoreError`.
- **Domain errors**: Typed errors let route layers map validation, cap, crypto, and config failures to client responses.

## Installation and setup

Install the package from the registry:

```sh
pnpm add @shipfox/api-secrets
```

Register `secretsModule` before modules that read or write secrets so its migrations run first.

## Usage

```ts
import {getSecret, secretsModule, setSecrets, setVariables} from '@shipfox/api-secrets';
import {initializeModules} from '@shipfox/node-module';

await initializeModules({modules: [secretsModule]});

await setSecrets({
  workspaceId: '018f1c9c-7c30-7f41-9c32-7668a7f3cc11',
  projectId: '018f1c9d-1b3c-7d4a-a5a2-8c2fdf4d7a91',
  namespace: 'system/agent/model-provider/openai',
  values: {API_KEY: 'sk-live-value'},
});

await setVariables({
  workspaceId: '018f1c9c-7c30-7f41-9c32-7668a7f3cc11',
  namespace: 'agent/defaults',
  values: {REGION: 'us-east-1'},
});

const apiKey = await getSecret({
  workspaceId: '018f1c9c-7c30-7f41-9c32-7668a7f3cc11',
  projectId: '018f1c9d-1b3c-7d4a-a5a2-8c2fdf4d7a91',
  namespace: 'system/agent/model-provider/openai',
  key: 'API_KEY',
});
```

## Namespaces

Namespaces group values that belong to one module-owned purpose. Use lowercase
slug paths in this shape:

```text
<module>/<entity>/<id>
```

Use the module name first, then the entity type, then the entity identifier. For
module-internal records that should not appear in user-facing management lists,
prefix the namespace with `system/`:

```text
system/<module>/<entity>/<id>
```

For example, agent model-provider credentials for OpenAI live under:

```text
system/agent/model-provider/openai
```

Keep the namespace specific to the entity that owns the keys. Do not put several
unrelated entity types under the same namespace; create separate namespaces such
as `system/agent/model-provider/openai` and `system/agent/<other-entity>/<id>`.

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `SECRETS_ENCRYPTION_KEK` | none | Required base64-encoded 32-byte key used to wrap workspace data keys. Generate one per environment. |
| `SECRETS_ENCRYPTION_KEK_PREVIOUS` | none | Previous KEK needed during rotation and for normal operations until all workspace data keys are re-wrapped. Set it to the old key until data-key rotation completes. |
| `SECRETS_MAX_PER_WORKSPACE` | `10000` | Maximum total count of secrets and variables in one workspace. The count includes all namespaces and project scopes. |
| `SECRETS_SHORT_VALUE_WARN_LENGTH` | `12` | Length below which management routes can show a short-secret warning. The core store does not emit the warning itself. |

Startup checks each KEK as a canonical base64 value for a 32-byte key. It also rejects non-positive numeric limits.

## API

| Function | Result |
| --- | --- |
| `setSecrets({workspaceId, projectId?, namespace?, values, editedBy?})` | Encrypts and upserts a batch of secret values. |
| `getSecret({workspaceId, projectId?, namespace?, key, store?})` | Returns one plaintext secret or `null`. Project scope wins over workspace scope. |
| `getSecretsByNamespace({workspaceId, projectId?, namespace?, store?})` | Returns plaintext secrets in a namespace. Project scope wins over workspace scope. |
| `deleteSecrets({workspaceId, projectId?, namespace?, keys?})` | Deletes exact-scope secrets. Omitted `keys` deletes the scope namespace. Empty `keys` deletes nothing. |
| `setVariables({workspaceId, projectId?, namespace?, values, editedBy?})` | Upserts plaintext variables with the same validation and cap rules as secrets. |
| `getVariable({workspaceId, projectId?, namespace?, key})` | Returns one variable or `null`. Project scope wins over workspace scope. |
| `getVariablesByNamespace({workspaceId, projectId?, namespace?})` | Returns variables in a namespace. Project scope wins over workspace scope. |
| `deleteVariables({workspaceId, projectId?, namespace?, keys?})` | Deletes exact-scope variables. Omitted `keys` deletes the scope namespace. Empty `keys` deletes nothing. |
| `rotateWorkspaceDataKeys()` | Re-wraps stored data keys from the previous KEK to the current KEK. |

Keys must match `^[A-Z_][A-Z0-9_]*$`. Keys and namespaces may be at most 128 characters. Namespaces may be empty or a lowercase slug path.

## Data model

This module owns tables with the `secrets_` prefix.

| Table | Purpose |
| --- | --- |
| `secrets_data_keys` | Stores one wrapped data-encryption key per workspace. The row includes the KEK version used to wrap it. |
| `secrets_values` | Stores encrypted secret values, a keyed HMAC fingerprint, scope columns, and edit metadata. |
| `secrets_variables` | Stores plaintext variable values, scope columns, and edit metadata. |

`secrets_values` and `secrets_variables` use partial unique indexes for scope:

- Workspace scope is unique by `(workspace_id, namespace, key)` where `project_id IS NULL`.
- Project scope is unique by `(workspace_id, project_id, namespace, key)` where `project_id IS NOT NULL`.

The database checks key and namespace patterns. The core layer also validates them before writing.

## Security Model

### Trust boundary

This package is an in-process storage module. It does not perform user authorization.

Callers must derive `workspaceId`, `projectId`, and namespace from trusted context. Do not pass attacker-controlled scope values into the store functions.

Secret management routes should keep secret values write-only at the HTTP boundary. Internal callers may read plaintext secrets only after their own tenancy checks pass.

### Encryption

Secret values use envelope encryption.

- Each workspace has one 32-byte data-encryption key (DEK).
- The DEK is generated with `crypto.randomBytes(32)` on first use.
- The DEK is wrapped with the configured key-encryption key (KEK) and stored in `secrets_data_keys`.
- Secret values are encrypted with AES-256-GCM under the plaintext DEK.
- Ciphertexts are encoded as `v1:<base64(iv || authTag || ciphertext)>`.
- AES-GCM uses a fresh 12-byte IV for each seal.

Additional authenticated data binds encrypted values to:

- `workspaceId`
- scope, either workspace or project ID
- namespace
- key

Moving ciphertext to another scope makes decryption fail closed with `SecretDecryptionError`.

### Key handling

`SECRETS_ENCRYPTION_KEK` is the current KEK. It must be a canonical base64-encoded 32-byte value. Startup rejects malformed, unpadded, over-padded, or whitespace-tainted keys.

`SECRETS_ENCRYPTION_KEK_PREVIOUS` supports rotation. During that window, the key provider can unwrap DEKs with the old KEK and wrap them with the new KEK.

KEK versions come from a domain-separated SHA-256 hash of the KEK. The version is stored with each wrapped DEK. Rotation refuses unknown KEK versions.

Plaintext DEKs are cached in memory for hot reads. The cache has a size limit and TTL. The manager stores cache-owned Buffer copies and returns defensive copies. Node cannot promise full memory wipes, so the design limits how long keys stay in memory.

### Rotation

KEK rotation re-wraps DEKs only. It does not re-encrypt `secrets_values`.

Rotation pages over `secrets_data_keys`. It unwraps each DEK with the previous KEK and wraps it with the current KEK. The update uses compare-and-swap on the old version. If two rotations race, one wins and the other skips the row.

After each unwrap in the rotation path, the temporary plaintext DEK Buffer is filled with zeroes.

### Fingerprints

`secrets_values.fingerprint` stores a keyed HMAC-SHA256 digest of the secret value using the workspace DEK. It is not a plaintext suffix.

The fingerprint supports equality and display workflows without storing part of the secret in clear text. A database leak does not reveal the end of a secret through this column.

### Failure behavior

Secret decryption failures collapse to `SecretDecryptionError`. The error does not include secret values, key material, or ciphertext.

Deleting a workspace data key makes existing secrets unreadable. Reads fail closed instead of returning unauthenticated plaintext.

## Behavior notes

- **Scope precedence:** project-scoped rows override workspace-scoped rows on reads and namespace lists.
- **Exact deletes:** deletes target only the exact scope passed by the caller. Deleting a project secret does not delete the workspace fallback.
- **Batch writes:** each write batch must target one scope. Mixed workspace and project rows are rejected by the persistence layer.
- **Workspace cap:** cap checks count secrets and variables together. The check runs inside the write transaction. It uses a workspace advisory lock and counts only net-new keys.
- **Variables:** variables are plaintext by design. Use them for non-secret config only.
- **Stores:** `local` is the only built-in store. Unknown stores throw `UnknownSecretStoreError`.

## Development

The tests use PostgreSQL. Start local services before running package tests:

```sh
docker compose up -d
turbo build --filter=@shipfox/api-secrets
turbo check --filter=@shipfox/api-secrets
turbo type --filter=@shipfox/api-secrets
turbo test --filter=@shipfox/api-secrets
```

## License

MIT
