// Transparent proxy to poe2scout.com/api. Solves CORS for the browser and
// adds a single User-Agent header per their requested usage policy.
import { NextRequest } from "next/server";

export const runtime = "edge";
export const revalidate = 120;

export async function GET(req: NextRequest, { params }: { params: { path: string[] } }) {
  const sub = (params.path ?? []).join("/");
  const url = new URL(req.url);
  const upstream = `https://poe2scout.com/api/${sub}${url.search}`;
  const r = await fetch(upstream, {
    headers: {
      "User-Agent": "poe2-ev/0.1 (contact your-email-here)",
      Accept: "application/json",
    },
    next: { revalidate: 120 },
  });
  return new Response(await r.text(), {
    status: r.status,
    headers: {
      "Content-Type": r.headers.get("content-type") ?? "application/json",
      "Cache-Control": "s-maxage=120, stale-while-revalidate=600",
    },
  });
}
