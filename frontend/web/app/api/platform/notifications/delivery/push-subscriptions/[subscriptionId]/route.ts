import { forwardNotificationDeliveryPushSubscription } from "../../../../../../../lib/notifications-bff";

export const dynamic = "force-dynamic";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ subscriptionId: string }> },
): Promise<Response> {
  const { subscriptionId } = await context.params;
  return forwardNotificationDeliveryPushSubscription(request, subscriptionId);
}
