import { getPersonal, putPersonal } from "../../../../../lib/profile-section-bff";

export const dynamic = "force-dynamic";

export async function GET(request?: Request): Promise<Response> {
  return getPersonal(request);
}

export async function PUT(request: Request): Promise<Response> {
  return putPersonal(request);
}
