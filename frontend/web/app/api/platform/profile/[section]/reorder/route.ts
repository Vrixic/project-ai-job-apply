import { reorderEntries } from "../../../../../../lib/profile-section-bff";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ section: string }> },
): Promise<Response> {
  return reorderEntries(request, (await context.params).section);
}
