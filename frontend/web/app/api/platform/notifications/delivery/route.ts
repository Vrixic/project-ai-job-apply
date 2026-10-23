import { forwardNotificationDeliveryStatus } from "../../../../../lib/notifications-bff";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return forwardNotificationDeliveryStatus(request);
}
