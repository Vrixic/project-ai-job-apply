import { ResumePageClient } from "./resume-page-client";

export const dynamic = "force-dynamic";

export default function ResumePage() {
  return <ResumePageClient authenticated />;
}
