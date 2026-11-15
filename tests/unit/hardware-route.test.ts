import { describe, it, expect } from "vitest";
import { GET } from "../../src/app/api/system/hardware/route";

describe("GET /api/system/hardware", () => {
  it("returns 200 with precision hardware telemetry and media limits", async () => {
    const res = await GET();
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.profile).toBeDefined();
    expect(data.profile.limits.maxBatchFiles.photo).toBeGreaterThanOrEqual(200);
    expect(data.profile.limits.maxBatchFiles.audio).toBeGreaterThanOrEqual(100);
    expect(data.profile.limits.maxBatchFiles.videoEncode).toBeGreaterThanOrEqual(20);
    expect(data.timestamp).toBeDefined();
  });
});
