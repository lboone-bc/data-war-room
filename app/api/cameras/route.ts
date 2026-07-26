import { NextRequest, NextResponse } from "next/server";
import { getServerConfig } from "@/lib/config";
import {
  getTrafficCameraMetadataResponse,
  isTrafficCameraId
} from "@/lib/trafficCameras";

export const dynamic = "force-dynamic";

function hasAccess(request: NextRequest, expectedToken: string | null) {
  if (!expectedToken) return true;
  return (
    request.headers.get("x-wallboard-token") === expectedToken ||
    request.nextUrl.searchParams.get("token") === expectedToken
  );
}

export async function GET(request: NextRequest) {
  const config = getServerConfig();
  if (!hasAccess(request, config.wallboardAccessToken)) {
    return NextResponse.json(
      { error: "Wallboard access token is missing or invalid." },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  const requestedId = request.nextUrl.searchParams.get("cameraId");
  const forceCameraId =
    request.nextUrl.searchParams.get("refresh") === "1" &&
    requestedId &&
    isTrafficCameraId(requestedId)
      ? requestedId
      : null;
  const result = await getTrafficCameraMetadataResponse(
    config.driveNcApiKey,
    forceCameraId
  );
  return NextResponse.json(result.cameras, {
    status: result.status,
    headers: {
      "Cache-Control": "no-store",
      ...result.headers
    }
  });
}
