import { applicationsRoute } from "../../../../../../../lib/applications-bff";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<Record<string, string>> },
): Promise<Response> {
  return applicationsRoute("generatedResumeOriginal", request, await context.params);
}
