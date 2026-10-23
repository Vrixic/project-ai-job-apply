import { forwardNotificationDeliveryTest } from "../../../../../../lib/notifications-bff";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return forwardNotificationDeliveryTest(request);
}
