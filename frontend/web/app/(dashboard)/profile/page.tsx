import { isRestrictedAnswerVaultUiEnabled } from "../../../lib/restricted-answer-fields";
import { ProfilePageClient } from "./profile-page-client";

export const dynamic = "force-dynamic";

export default function ProfilePage() {
  return (
    <ProfilePageClient
      authenticated
      restrictedAnswerVaultUiEnabled={isRestrictedAnswerVaultUiEnabled()}
    />
  );
}
