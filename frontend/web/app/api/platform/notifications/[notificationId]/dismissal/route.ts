import { forwardNotificationCommand } from "../../../../../../lib/notifications-bff";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ notificationId: string }> },
): Promise<Response> {
  const { notificationId } = await context.params;
  return forwardNotificationCommand(request, notificationId, "dismissal");
}
