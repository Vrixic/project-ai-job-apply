import { forwardNotificationPreferences } from "../../../../../lib/notifications-bff";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return forwardNotificationPreferences(request);
}

export async function PUT(request: Request): Promise<Response> {
  return forwardNotificationPreferences(request);
}
