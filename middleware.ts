import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const expectedToken = process.env.WALLBOARD_ACCESS_TOKEN;
  if (!expectedToken) return NextResponse.next();

  const token = request.nextUrl.searchParams.get("token");
  const cookieToken = request.cookies.get("wallboard_token")?.value;

  if (token === expectedToken) {
    const response = NextResponse.next();
    response.cookies.set("wallboard_token", token, {
      httpOnly: false,
      sameSite: "strict",
      secure: request.nextUrl.protocol === "https:",
      path: "/",
      maxAge: 60 * 60 * 24 * 180
    });
    return response;
  }

  if (cookieToken === expectedToken) return NextResponse.next();

  return new NextResponse("Wallboard access token is required.", {
    status: 401,
    headers: {
      "content-type": "text/plain"
    }
  });
}

export const config = {
  matcher: ["/wallboard/:path*"]
};

