import { createEntry, listSection } from "../../../../../lib/profile-section-bff";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ section: string }> },
): Promise<Response> {
  return listSection((await context.params).section, request);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ section: string }> },
): Promise<Response> {
  return createEntry(request, (await context.params).section);
}
