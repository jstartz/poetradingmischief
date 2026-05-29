import { NextRequest } from "next/server";
import { evaluateProject, simulate, type CraftProject } from "@/lib/ev";

export const runtime = "edge";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { project: CraftProject; sims?: number };
    const result = evaluateProject(body.project);
    if (!result.ok) return Response.json({ ok: false, error: result.error }, { status: 400 });
    const sim = simulate(body.project, body.sims ?? 5000);
    return Response.json({ ok: true, result, sim });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message ?? "Bad request" }, { status: 400 });
  }
}
