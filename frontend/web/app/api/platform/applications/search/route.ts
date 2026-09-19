import { applicationsRoute } from "../../../../../lib/applications-bff";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return applicationsRoute("search", request, {});
}
