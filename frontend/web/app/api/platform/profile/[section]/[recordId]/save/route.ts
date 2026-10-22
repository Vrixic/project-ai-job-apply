import { saveDraft } from "../../../../../../../lib/profile-section-bff";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ section: string; recordId: string }> },
): Promise<Response> {
  const { section, recordId } = await context.params;
  return saveDraft(request, section, recordId);
}
