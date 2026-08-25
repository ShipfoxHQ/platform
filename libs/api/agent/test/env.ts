process.env.POSTGRES_HOST ??= 'localhost';
process.env.POSTGRES_PORT ??= '5432';
process.env.POSTGRES_USERNAME ??= 'shipfox';
process.env.POSTGRES_PASSWORD ??= 'password';
process.env.POSTGRES_DATABASE = 'api_test';
process.env.POSTGRES_MAX_CONNECTIONS ??= '5';
process.env.TZ = 'UTC';
process.env.SECRETS_ENCRYPTION_KEK = 'ZmVkY2JhOTg3NjU0MzIxMGZlZGNiYTk4NzY1NDMyMTA=';
process.env.AGENT_SESSION_ENCRYPTION_KEK = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=';

// Real Garage dev credentials. Artifact store tests use the agent-sessions prefix
// in the shared test bucket that bootstrap.sh creates.
process.env.OBJECT_STORAGE_S3_ENDPOINT ??= 'http://localhost:3900';
process.env.OBJECT_STORAGE_S3_REGION = 'garage';
process.env.OBJECT_STORAGE_S3_BUCKET = 'shipfox-test';
process.env.OBJECT_STORAGE_S3_ACCESS_KEY_ID = 'GK000000000000000000000000';
process.env.OBJECT_STORAGE_S3_SECRET_ACCESS_KEY =
  '0000000000000000000000000000000000000000000000000000000000000000';
process.env.OBJECT_STORAGE_S3_FORCE_PATH_STYLE = 'true';
