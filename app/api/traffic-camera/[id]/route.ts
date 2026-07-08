import { NextRequest, NextResponse } from "next/server";
import { getTrafficCameraImage } from "@/lib/trafficCameras";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const image = await getTrafficCameraImage(params.id, {
    forceRefresh: request.nextUrl.searchParams.has("refresh")
  });

  if (!image) {
    return NextResponse.json(
      { error: "Traffic camera image unavailable." },
      { status: 503 }
    );
  }

  const body = image.bytes.buffer.slice(
    image.bytes.byteOffset,
    image.bytes.byteOffset + image.bytes.byteLength
  ) as ArrayBuffer;

  return new NextResponse(body, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": image.contentType,
      "X-Camera-Fetched-At": new Date(image.fetchedAt).toISOString()
    }
  });
}
