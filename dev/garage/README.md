# Local object storage (Garage)

Runner logs and encrypted agent session transcripts use an S3-compatible object store. For local
development and self-hosting, `compose.yml` bundles [Garage](https://garagehq.deuxfleurs.fr/);
any S3-compatible endpoint (AWS S3, Cloudflare R2, Backblaze B2, MinIO, …) works
in production.

| Setting | Value |
| -- | -- |
| Endpoint | `http://localhost:3900` |
| Region | `garage` |
| Bucket | `shipfox` |
| Access key id | `GK000000000000000000000000` |

The secret in `garage.toml` and the access key are **development-only**.
Generate fresh credentials for any shared or production environment, and set the
`OBJECT_STORAGE_S3_*` variables accordingly (see `libs/shared/node/object-storage/src/config.ts`).

Logs use the `logs` key prefix. Agent session transcripts use the
`agent-sessions` key prefix. Set a consumer-specific `*_STORAGE_S3_*` override
only when that consumer needs another bucket or object store.

## Bucket lifecycle (production)

A crashed compaction can leave an incomplete multipart upload behind. On
pay-per-storage providers (S3, R2) those parts bill until they are aborted, and
the API worker never sets bucket policy (its credentials are limited to object
read and write). So the bucket must carry an `AbortIncompleteMultipartUpload`
lifecycle rule. `bootstrap.sh` provisions it on the local Garage bucket; set the
same rule (for example, abort one day after initiation) on any shared or
production bucket.

## Browser reads

The log read path serves compacted objects through presigned URLs fetched
directly by the browser, so the bucket needs CORS configured to allow the
dashboard origin. `bootstrap.sh` provisions a read-only browser CORS rule for
`http://localhost:5173` on the local Garage buckets. Override it with
`GARAGE_CORS_ALLOWED_ORIGINS` when your local client uses another origin; use a
comma-separated list for several origins.
