import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";

import { createLarkResourceClient } from "../src/lark/resources.js";

describe("lark resources", () => {
  it("downloads an image resource into the target directory with a safe file name", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "lark-connect-resource-test-"));
    const observedDownloads = [];
    const client = await createLarkResourceClient(
      {
        appId: "cli_test",
        appSecret: "secret",
      },
      {
        channelFactory: async () => ({
          rawClient: {
            im: {
              v1: {
                messageResource: {
                  async get(payload) {
                    observedDownloads.push(payload);
                    return {
                      getReadableStream() {
                        return Readable.from([Buffer.from("image-bytes")]);
                      },
                    };
                  },
                },
              },
            },
          },
        }),
      },
    );

    try {
      const result = await client.downloadResource({
        agentSessionId: "thread_a",
        messageId: "om_resource",
        resource: {
          type: "image",
          fileKey: "img_1",
          fileName: "../screen.png",
        },
        outputDir,
      });

      assert.deepEqual(observedDownloads, [
        {
          path: {
            message_id: "om_resource",
            file_key: "img_1",
          },
          params: {
            type: "image",
          },
        },
      ]);
      assert.deepEqual(result, {
        agentSessionId: "thread_a",
        messageId: "om_resource",
        fileKey: "img_1",
        resourceType: "image",
        fileName: "screen.png",
        filePath: join(outputDir, "screen.png"),
        size: 11,
      });
      assert.equal(await readFile(result.filePath, "utf8"), "image-bytes");
    } finally {
      await client.close();
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  it("uses a fallback file name when resource metadata does not provide one", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "lark-connect-resource-test-"));
    const client = await createLarkResourceClient(
      {
        appId: "cli_test",
        appSecret: "secret",
      },
      {
        channelFactory: async () => ({
          rawClient: {
            im: {
              v1: {
                messageResource: {
                  async get() {
                    return {
                      getReadableStream() {
                        return Readable.from([Buffer.from("file-bytes")]);
                      },
                    };
                  },
                },
              },
            },
          },
        }),
      },
    );

    try {
      const result = await client.downloadResource({
        agentSessionId: "thread_a",
        messageId: "om_resource",
        resource: {
          type: "file",
          fileKey: "file_1",
        },
        outputDir,
      });

      assert.equal(result.fileName, "file_1.file");
      assert.equal(await readFile(result.filePath, "utf8"), "file-bytes");
    } finally {
      await client.close();
      await rm(outputDir, { recursive: true, force: true });
    }
  });
});
