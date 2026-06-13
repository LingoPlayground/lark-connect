# Lark Send Media Validation Contract

## Automated Checks

- VAL-MEDIA-001: Message client sends `lark_connect_send_image` payloads as native image messages using the existing channel `send` abstraction.
- VAL-MEDIA-002: Message client uploads the video cover image through Feishu's message image upload API before sending a native video message.
- VAL-MEDIA-003: HTTP daemon routes image and video send requests to the chat bound to the agent session.
- VAL-MEDIA-004: HTTP daemon rejects image and video sends with `SESSION_NOT_BOUND` before invoking the message client when the session is unbound.
- VAL-MEDIA-005: MCP lists `lark_connect_send_image` and `lark_connect_send_video`.
- VAL-MEDIA-006: MCP forwards image and video tool calls to the local daemon client with all reply metadata.
- VAL-MEDIA-007: Daemon runner wires the shared message client into image and video sending.

## Live Checks

- VAL-MEDIA-LIVE-001: Calling `lark_connect_send_image` from the MCP server sends a Feishu message whose `msg_type` is `image`.
- VAL-MEDIA-LIVE-002: Calling `lark_connect_send_video` from the MCP server sends a Feishu message whose `msg_type` is `media`.
- VAL-MEDIA-LIVE-003: Live verification uses `lark-cli` only to inspect or compare Feishu results, not as a runtime dependency of this project.
