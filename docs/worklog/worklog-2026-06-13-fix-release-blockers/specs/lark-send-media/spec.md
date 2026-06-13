# Lark Send Media Spec

## Summary

Add MCP tools for sending local images and videos to the Feishu group that is already bound to a Codex thread or Claude Code session.

## User Value

Engineers can send a built screen, screenshot, or short recording back to the review group as native Feishu media instead of generic file attachments. Designers and product managers can inspect the result directly in the chat.

## Functional Requirements

1. `lark_connect_send_image` sends a local image file to the currently bound chat as a native Feishu image message.
2. `lark_connect_send_video` sends a local video file to the currently bound chat as a native Feishu video message.
3. Video sending requires an explicit local cover image path. Prior live verification showed Feishu's no-cover video path can produce an unreadable message, so the first supported path always uploads a cover image first.
4. Both tools require `agentSessionId` and use the chat bound to that session. The caller cannot override the destination chat.
5. Both tools support optional `replyToMessageId` and `replyInThread` options.
6. If the session is not bound, the tools return the existing `SESSION_NOT_BOUND` error and do not upload or send anything.
7. Sent message responses include the new Feishu message id, bound chat id, agent session id, local media paths, and reply metadata when provided.

## Non-Goals

- Sending remote URLs.
- Batch media sending.
- Automatically generating a video cover image.
- Sending video without a cover image.
- Downloading video resources.
- Arbitrary reaction sending.

## Interfaces

### MCP Tool: `lark_connect_send_image`

Input:

```json
{
  "agentSessionId": "thread_or_session_id",
  "imagePath": "/absolute/path/screen.png",
  "replyToMessageId": "om_optional",
  "replyInThread": true
}
```

Output:

```json
{
  "message": {
    "id": "om_sent",
    "larkMessageId": "om_sent",
    "chatId": "oc_target",
    "agentSessionId": "thread_or_session_id",
    "imagePath": "/absolute/path/screen.png",
    "replyToMessageId": "om_optional",
    "replyInThread": true
  }
}
```

### MCP Tool: `lark_connect_send_video`

Input:

```json
{
  "agentSessionId": "thread_or_session_id",
  "videoPath": "/absolute/path/demo.mp4",
  "coverImagePath": "/absolute/path/demo-cover.png",
  "replyToMessageId": "om_optional",
  "replyInThread": true
}
```

Output:

```json
{
  "message": {
    "id": "om_sent",
    "larkMessageId": "om_sent",
    "chatId": "oc_target",
    "agentSessionId": "thread_or_session_id",
    "videoPath": "/absolute/path/demo.mp4",
    "coverImagePath": "/absolute/path/demo-cover.png",
    "coverImageKey": "img_cover_key",
    "replyToMessageId": "om_optional",
    "replyInThread": true
  }
}
```

## Notes

Implementation must use the Feishu Node SDK through the existing Lark channel abstraction. `lark-cli` may be used as a manual verification oracle, but the runtime implementation must not depend on it.
