import { NextRequest, NextResponse } from "next/server";

const NARRATIVE_URL = process.env.NARRATIVE_URL ?? process.env.LEDGER_URL ?? "http://localhost:8000";

async function proxy(req: NextRequest, path: string[]) {
  const upstream = `${NARRATIVE_URL}/api/${path.join("/")}${req.nextUrl.search}`;

  const headers = new Headers();
  const auth = req.headers.get("authorization");
  const ct = req.headers.get("content-type");
  if (auth) headers.set("authorization", auth);
  if (ct) headers.set("content-type", ct);

  const body = ["GET", "HEAD"].includes(req.method) ? undefined : await req.arrayBuffer();

  const res = await fetch(upstream, {
    method: req.method,
    headers,
    body,
  });

  const resBody = await res.arrayBuffer();
  return new NextResponse(resBody, {
    status: res.status,
    headers: { "content-type": res.headers.get("content-type") ?? "application/json" },
  });
}

export async function GET(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(req, params.path);
}
export async function POST(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(req, params.path);
}
export async function PUT(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(req, params.path);
}
export async function PATCH(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(req, params.path);
}
export async function DELETE(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(req, params.path);
}
