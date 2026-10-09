import { applicationsRoute } from "../../../../../../../lib/applications-bff";

export async function GET(
  request: Request,
  context: { params: Promise<{ applicationId: string }> },
): Promise<Response> {
  return applicationsRoute("coverLetterLocation", request, await context.params);
}
