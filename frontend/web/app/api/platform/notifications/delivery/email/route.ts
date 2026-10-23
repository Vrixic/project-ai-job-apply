import { forwardNotificationDeliveryEmail } from "../../../../../../lib/notifications-bff";

export const dynamic = "force-dynamic";

export async function PUT(request: Request): Promise<Response> {
  return forwardNotificationDeliveryEmail(request);
}

export async function DELETE(request: Request): Promise<Response> {
  return forwardNotificationDeliveryEmail(request);
}
