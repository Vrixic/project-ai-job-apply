import { applicationsRoute } from "../../../../../../lib/applications-bff";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<Record<string, string>> },
): Promise<Response> {
  return applicationsRoute("resumePreview", request, await context.params);
}
