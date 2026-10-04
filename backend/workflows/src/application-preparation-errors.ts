export class PreparationDispatchPendingError extends Error {
  constructor() {
    super("PreparationDispatchPending");
    this.name = "PreparationDispatchPendingError";
  }
}
