import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";

import { createDefaultLarkChannel } from "./channel.js";

function requireResourceConfig(config) {
  if (!config.appId) throw new Error("FEISHU_APP_ID is required for resources");
  if (!config.appSecret) throw new Error("FEISHU_APP_SECRET is required for resources");
}

function safePathSegment(value, fallback) {
  const normalized = String(value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || fallback;
}

function safeFileName(value, fallback) {
  const candidate = basename(String(value ?? "").replaceAll("\0", "").trim())
    .replace(/[\\/]+/g, "_")
    .replace(/[\r\n]/g, "")
    .trim();
  if (!candidate || candidate === "." || candidate === "..") return fallback;
  return candidate;
}

function requireResource(resource) {
  const fileKey = String(resource?.fileKey ?? "").trim();
  if (!fileKey) throw new Error("fileKey is required");

  if (resource.type !== "image" && resource.type !== "file") {
    throw new Error(`resource type ${resource.type ?? ""} is not supported`);
  }

  return {
    type: resource.type,
    fileKey,
    fileName: resource.fileName,
  };
}

function requireMessageId(messageId) {
  const normalized = String(messageId ?? "").trim();
  if (!normalized) throw new Error("messageId is required");
  return normalized;
}

async function bufferFromStream(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function defaultOutputDir(input) {
  return join(
    tmpdir(),
    "lark-connect",
    "resources",
    safePathSegment(input.agentSessionId, "session"),
    safePathSegment(input.messageId, "message"),
  );
}

function resolveDownloadPath(outputDir, fileName) {
  const root = resolve(outputDir);
  const filePath = resolve(root, fileName);
  if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
    throw new Error("download path escapes outputDir");
  }
  return filePath;
}

export async function createLarkResourceClient(config, options = {}) {
  requireResourceConfig(config);

  const channelFactory = options.channelFactory ?? createDefaultLarkChannel;
  const channel = await channelFactory(config);

  return {
    async downloadResource(input) {
      const resource = requireResource(input.resource);
      const messageId = requireMessageId(input.messageId);
      const fallbackName = `${safePathSegment(resource.fileKey, "resource")}.${resource.type}`;
      const fileName = safeFileName(resource.fileName, fallbackName);
      const outputDir = input.outputDir
        ? String(input.outputDir).trim()
        : defaultOutputDir(input);
      if (!outputDir) throw new Error("outputDir is required");

      await mkdir(outputDir, { recursive: true });
      const filePath = resolveDownloadPath(outputDir, fileName);
      const response = await channel.rawClient.im.v1.messageResource.get({
        path: {
          message_id: messageId,
          file_key: resource.fileKey,
        },
        params: {
          type: resource.type,
        },
      });
      const data = await bufferFromStream(response.getReadableStream());
      await writeFile(filePath, data);

      return {
        agentSessionId: input.agentSessionId,
        messageId,
        fileKey: resource.fileKey,
        resourceType: resource.type,
        fileName,
        filePath,
        size: data.byteLength,
      };
    },

    async close() {
      await channel.disconnect?.();
    },
  };
}
