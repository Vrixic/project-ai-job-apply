import { deleteRecord, updateEntry } from "../../../../../../lib/profile-section-bff";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ section: string; recordId: string }> },
): Promise<Response> {
  const { section, recordId } = await context.params;
  return updateEntry(request, section, recordId);
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ section: string; recordId: string }> },
): Promise<Response> {
  const { section, recordId } = await context.params;
  return deleteRecord(request, section, recordId);
}
