import { applicationsRoute } from "../../../../../../../../lib/applications-bff";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<Record<string, string>> },
): Promise<Response> {
  return applicationsRoute("recordResult", request, await context.params);
}
