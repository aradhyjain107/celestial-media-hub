import { describe, expect, test, vi, beforeEach } from "vitest";
import fsMock from "node:fs";
import { EventEmitter } from "node:events";
import React from "react";
import { renderHook, act } from "@testing-library/react";

const { mockSpawn } = vi.hoisted(() => ({
  mockSpawn: vi.fn()
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, spawn: mockSpawn, default: { ...actual.default, spawn: mockSpawn } };
});

vi.mock("../../src/lib/system/env", () => ({
  env: {
    TEMP_DIR: "/mock/temp",
    FFMPEG_PATH: "ffmpeg",
    YTDLP_PATH: "yt-dlp",
    JWT_SECRET: "01234567890123456789012345678901",
  }
}));

import { CelestialStreamer } from "../../src/lib/media/engine/pipe";
import { startTempDirSweeper, writeInputFile } from "../../src/lib/system/temp";
import { GlobalJobProvider, useJob, resetGlobalJobStore } from "../../src/app/context/GlobalJobContext";

describe("Milestone M1 Infrastructure Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetGlobalJobStore();
  });

  describe("lib/temp.ts — TTL Sweeper & ArrayBuffer Chunking", () => {
    test("writeInputFile properly slices large buffers into <=16MB chunks without Buffer.from crash", async () => {
      vi.spyOn(fsMock, "existsSync").mockReturnValue(true);
      const writes: any[] = [];
      const mockHandle = {
        write: vi.fn().mockImplementation((chunk, offset, len) => {
          writes.push({ byteLength: chunk.byteLength, len });
          return Promise.resolve({ bytesWritten: len || chunk.byteLength });
        }),
        close: vi.fn().mockResolvedValue(undefined)
      };
      vi.spyOn(fsMock.promises, "open").mockResolvedValue(mockHandle as any);

      // Create a 35MB Uint8Array (larger than 16MB chunk limit)
      const largeArray = new Uint8Array(35 * 1024 * 1024);
      const filePath = await writeInputFile("job_large", "test.bin", largeArray.buffer);

      expect(filePath).toBe("/mock/temp/job_large/test.bin");
      expect(mockHandle.write).toHaveBeenCalledTimes(3); // 16MB + 16MB + 3MB
      expect(writes[0].len).toBe(16 * 1024 * 1024);
      expect(writes[1].len).toBe(16 * 1024 * 1024);
      expect(writes[2].len).toBe(3 * 1024 * 1024);
      expect(mockHandle.close).toHaveBeenCalled();
    });

    test("startTempDirSweeper safely scans and removes directories older than TTL", async () => {
      vi.useFakeTimers();
      vi.spyOn(fsMock, "existsSync").mockReturnValue(true);
      vi.spyOn(fsMock.promises, "readdir").mockResolvedValue([
        { name: "job_expired", isDirectory: () => true } as any,
        { name: "job_fresh", isDirectory: () => true } as any,
        { name: "orphan_file.log", isDirectory: () => false } as any,
      ]);
      const rmSpy = vi.spyOn(fsMock.promises, "rm").mockResolvedValue(undefined as any);
      vi.spyOn(fsMock.promises, "stat").mockImplementation(async (targetPath: any) => {
        if (String(targetPath).includes("job_expired")) {
          return { mtimeMs: Date.now() - (35 * 60 * 1000) } as any;
        }
        return { mtimeMs: Date.now() - (2 * 60 * 1000) } as any;
      });

      const timer = startTempDirSweeper(30 * 60 * 1000, 1000);
      await vi.advanceTimersByTimeAsync(1000);

      expect(rmSpy).toHaveBeenCalledWith("/mock/temp/job_expired", { recursive: true, force: true });
      expect(rmSpy).not.toHaveBeenCalledWith("/mock/temp/job_fresh", expect.anything());

      clearInterval(timer);
      vi.useRealTimers();
    });
  });

  describe("lib/engine/pipe.ts — Backpressure & Process Error Handling", () => {
    test("CelestialStreamer attaches error handler on spawned child process and propagates spawn errors", async () => {
      const mockFfmpeg: any = new EventEmitter();
      mockFfmpeg.stdio = ["ignore", new EventEmitter(), new EventEmitter()];
      mockFfmpeg.stdout = new EventEmitter();
      mockFfmpeg.stdout.pipe = vi.fn();
      mockFfmpeg.stderr = new EventEmitter();

      mockSpawn.mockReturnValue(mockFfmpeg as any);

      const streamer = new CelestialStreamer();
      const output = streamer.mux([], { outputFormat: "mp4" });
      const errorSpy = vi.fn();
      output.on("error", errorSpy);

      const spawnErr = new Error("spawn ENOENT");
      mockFfmpeg.emit("error", spawnErr);

      expect(errorSpy).toHaveBeenCalledWith(spawnErr);
    });

    test("CelestialStreamer initiates source download with backpressure flow control", async () => {
      const mockTargetPipe = new EventEmitter() as any;
      let writeCount = 0;
      mockTargetPipe.write = vi.fn().mockImplementation((chunk) => {
        writeCount++;
        if (writeCount === 1) {
          // Trigger backpressure: return false
          setTimeout(() => mockTargetPipe.emit("drain"), 10);
          return false;
        }
        return true;
      });
      mockTargetPipe.end = vi.fn();
      mockTargetPipe.destroy = vi.fn();

      const mockFfmpeg: any = new EventEmitter();
      mockFfmpeg.stdio = ["ignore", new EventEmitter(), new EventEmitter(), mockTargetPipe];
      mockFfmpeg.stdout = new EventEmitter();
      mockFfmpeg.stdout.pipe = vi.fn();
      mockFfmpeg.stderr = new EventEmitter();

      mockSpawn.mockReturnValue(mockFfmpeg as any);

      const mockChunks = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6])];
      let chunkIdx = 0;
      const mockReadableStream = {
        getReader: () => ({
          read: vi.fn().mockImplementation(async () => {
            if (chunkIdx < mockChunks.length) {
              return { done: false, value: mockChunks[chunkIdx++] };
            }
            return { done: true, value: undefined };
          })
        })
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        body: mockReadableStream
      } as any);

      const streamer = new CelestialStreamer();
      streamer.mux([{ url: "http://example.com/video.mp4", type: "video", contentLength: 6 }], {
        outputFormat: "mp4"
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockTargetPipe.write).toHaveBeenCalledTimes(2);
      expect(mockTargetPipe.end).toHaveBeenCalled();
    });
  });

  describe("app/context/GlobalJobContext.tsx — CRLF SSE Stream Parsing", () => {
    test("correctly parses SSE chunks delimited by CRLF and strips carriage returns", async () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        React.createElement(GlobalJobProvider, null, children)
      );

      const { result } = renderHook(() => useJob("test-crlf-tool"), { wrapper });

      const ssePayload = "data: " + JSON.stringify({ progress: 50, strategy: "REMUX" }) + "\r\n\r\ndata: " + JSON.stringify({ status: "complete", downloadUrl: "/api/download?jobId=123" }) + "\r\n\r\n";
      const encoder = new TextEncoder();
      const chunks = [encoder.encode(ssePayload)];
      let index = 0;

      const mockStream = {
        getReader: () => ({
          read: vi.fn().mockImplementation(async () => {
            if (index < chunks.length) {
              return { done: false, value: chunks[index++] };
            }
            return { done: true, value: undefined };
          })
        })
      };

      const mockResponse = {
        body: mockStream
      } as any;

      await act(async () => {
        result.current.startJob(mockResponse);
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      expect(result.current.jobState?.status).toBe("complete");
      expect(result.current.jobState?.progress).toBe(100);
      expect(result.current.jobState?.downloadUrl).toBe("/api/download?jobId=123");
    });
  });
});
