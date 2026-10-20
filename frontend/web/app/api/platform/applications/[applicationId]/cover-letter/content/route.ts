import { nativeMaterialContentRoute } from "../../../../../../../lib/native-material-bff";

export async function GET(
  request: Request,
  context: { params: Promise<{ applicationId: string }> },
): Promise<Response> {
  return nativeMaterialContentRoute("cover-letter", request, await context.params);
}
