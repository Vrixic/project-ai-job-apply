import { applicationsRoute } from "../../../../../../../lib/applications-bff";

export async function GET(
  request: Request,
  context: { params: Promise<{ applicationId: string; preparationId: string }> },
): Promise<Response> {
  return applicationsRoute("preparation", request, await context.params);
}
