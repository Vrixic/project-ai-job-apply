import { nativeLaunchControlVersion } from "@ai-job-apply/documents-service/native-launch-control";
import {
  type NativeTaskLaunchConfiguration,
  nativeTaskLaunchConfiguration,
} from "@ai-job-apply/documents-service/native-task-launch";

type Environment = Readonly<Record<string, string | undefined>>;
export interface NativeMaterialControlConfiguration {
  target: string;
  secretId: string;
  task: ReturnType<typeof nativeTaskLaunchConfiguration>;
}
export function nativeMaterialControlConfiguration(
  env: Environment,
): NativeMaterialControlConfiguration | undefined {
  if (
    env.NATIVE_MATERIAL_LAUNCH_CONTROL_ENABLED !== "true" ||
    env.AWS_REGION !== "us-east-2" ||
    !/^[0-9]{12}$/u.test(env.PLATFORM_AWS_ACCOUNT_ID ?? "") ||
    !/^[A-Za-z0-9_-]{1,64}$/u.test(env.AWS_LAMBDA_FUNCTION_NAME ?? "") ||
    !env.AWS_SESSION_TOKEN ||
    [
      "DATABASE_URL",
      "OPENAI_API_KEY",
      "OPENAI_API_KEY_SECRET_ID",
      "COVER_LETTER_OPENAI_SECRET_ID",
    ].some((key) => env[key] !== undefined)
  )
    return;
  const target = `arn:aws:lambda:us-east-2:${env.PLATFORM_AWS_ACCOUNT_ID}:function:${env.AWS_LAMBDA_FUNCTION_NAME}:${env.AWS_LAMBDA_FUNCTION_VERSION}`;
  nativeLaunchControlVersion(target);
  const secretId = env.DATABASE_SECRET_ID;
  const json = env.NATIVE_MATERIAL_LAUNCH_CONFIGURATION_JSON;
  if (
    !secretId ||
    !new RegExp(
      `^arn:aws:secretsmanager:us-east-2:${env.PLATFORM_AWS_ACCOUNT_ID}:secret:[A-Za-z0-9/_+=.@-]{1,512}$`,
      "u",
    ).test(secretId) ||
    !json ||
    new TextEncoder().encode(json).length > 8_192
  )
    return;
  const task = nativeTaskLaunchConfiguration(JSON.parse(json) as NativeTaskLaunchConfiguration);
  if (!task.clusterArn.startsWith(`arn:aws:ecs:us-east-2:${env.PLATFORM_AWS_ACCOUNT_ID}:cluster/`))
    return;
  return { target, secretId, task };
}
