import { NextRequest, NextResponse } from "next/server";
import { getServerConfig } from "@/lib/config";
import { isTrafficCameraId } from "@/lib/trafficCameras";
import { getTrafficCameraSnapshot } from "@/lib/trafficCameraImage";

export const dynamic = "force-dynamic";

function hasAccess(request: NextRequest, expectedToken: string | null) {
  if (!expectedToken) return true;
  return (
    request.headers.get("x-wallboard-token") === expectedToken ||
    request.nextUrl.searchParams.get("token") === expectedToken
  );
}

async function cameraResponse(request: NextRequest, id: string, head = false) {
  const config = getServerConfig();
  if (!hasAccess(request, config.wallboardAccessToken)) {
    return new NextResponse("Wallboard access token is missing or invalid.", {
      status: 401,
      headers: { "Cache-Control": "no-store" }
    });
  }
  if (!isTrafficCameraId(id)) {
    return new NextResponse("Camera not found", {
      status: 404,
      headers: { "Cache-Control": "no-store" }
    });
  }

  const snapshot = await getTrafficCameraSnapshot(id);
  if (!snapshot) {
    return new NextResponse("Camera snapshot temporarily unavailable", {
      status: 503,
      headers: { "Cache-Control": "no-store", "Retry-After": "60" }
    });
  }

  const headers = {
    "Cache-Control": "private, max-age=55, stale-if-error=86400",
    "Content-Type": snapshot.contentType,
    "X-Wallboard-Camera-Cache": snapshot.stale ? "stale" : "fresh"
  };
  return new NextResponse(head ? null : new Uint8Array(snapshot.bytes.slice(0)), { headers });
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  return cameraResponse(request, params.id);
}

export async function HEAD(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  return cameraResponse(request, params.id, true);
}
