---
"@shipfox/react-ui": patch
"@shipfox/client-workspace-settings": patch
"@shipfox/client-invitations": patch
"@shipfox/client-secrets": patch
"@shipfox/client-config": patch
"@shipfox/client-shell": patch
"@shipfox/client-auth": patch
"@shipfox/client-logs": patch
---

Migrates the shell, auth, secrets, logs, workspace-settings, config, and invitations
surfaces to semantic spacing roles and brings them under the `no-raw-spacing` Biome
plugin. Adds shared menu-surface and edge-specific panel roles for existing spacing
contracts.
