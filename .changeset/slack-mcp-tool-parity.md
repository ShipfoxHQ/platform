---
"@shipfox/api-integration-slack": major
---

Rename the Slack agent tools to match the Slack MCP server and add channel metadata, channel members, scheduled messages, and canvas creation. Tool ids and parameters now follow the MCP naming (`read_thread`, `send_message`, `channel_id`, `message_ts`, `message`), messages are written as standard Markdown, and workflows selecting the previous ids have to be updated. Slack installations need reauthorization for the added `canvases:write` scope.
