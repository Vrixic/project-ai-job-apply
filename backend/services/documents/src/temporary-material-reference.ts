/** Documents compatibility export; shared scalar rules now serve packet admission as well. */
export {
  GENERATED_MATERIAL_LIFETIME_MS,
  sameTemporaryMaterialReference,
  type TemporaryMaterialReference,
  validateTemporaryMaterialReference,
} from "@ai-job-apply/domain/temporary-material";

export class TemporaryMaterialUnavailable extends Error {
  constructor() {
    super("TemporaryMaterialUnavailable");
    this.name = "TemporaryMaterialUnavailable";
  }
}
