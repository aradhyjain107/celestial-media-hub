import { NextResponse } from "next/server";
import { getServerHardwareProfile } from "../../../../lib/serverHardwareProfiler";
import { sanitizeError } from "../../../../lib/errors";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const profile = await getServerHardwareProfile();
    return NextResponse.json({
      success: true,
      profile,
      timestamp: new Date().toISOString(),
    });
  } catch (error: unknown) {
    const { error: msg, status } = sanitizeError(error, "GET /api/system/hardware");
    return NextResponse.json(
      {
        success: false,
        error: msg,
      },
      { status }
    );
  }
}
