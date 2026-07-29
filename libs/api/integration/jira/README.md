# Jira integration

This package owns Jira OAuth installation, webhook registration and ingestion, persistence, and token storage.

Connect Jira with a dedicated Shipfox service account. Jira 3LO actions are authored by the authorizing account, so events from that account are dropped to prevent agent actions from triggering themselves.
