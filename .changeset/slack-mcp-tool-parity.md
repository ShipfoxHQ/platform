---
"@shipfox/api-integration-slack": major
---

Rename the Slack agent tools to match the Slack MCP server and add channel metadata, channel members, scheduled messages, and canvas creation. Tool ids and parameters now follow the MCP naming (`read_thread`, `send_message`, `channel_id`, `message_ts`, `message`), messages are written as standard Markdown, and workflows selecting the previous ids have to be updated. `send_message`, `schedule_message`, and `update_message` now reject a message over Slack's 12,000-character Markdown block limit instead of forwarding it and failing, and their notification fallback text has Markdown syntax stripped instead of shown literally. Slack installations need reauthorization for the added `canvases:write`, `im:read`, `mpim:read`, and `mpim:history` scopes.
