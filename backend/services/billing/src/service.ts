import { CachedEntitlementAuthorizer, type EntitlementCache } from "./cache.js";
import type { ApplyEntitlementChangeInput, ApplyEntitlementChangeResult } from "./store.js";
import type { EntitlementEvaluation, EntitlementReader, EntitlementReadService } from "./types.js";

export interface EntitlementMutationStore {
  applyEntitlementChange(input: ApplyEntitlementChangeInput): Promise<ApplyEntitlementChangeResult>;
}

export interface BillingEntitlementStore extends EntitlementReader, EntitlementMutationStore {
  ping(): Promise<void>;
}

export class BillingEntitlementService implements EntitlementReadService {
  readonly #authorizer: CachedEntitlementAuthorizer;

  constructor(
    private readonly store: BillingEntitlementStore,
    private readonly cache: EntitlementCache,
  ) {
    this.#authorizer = new CachedEntitlementAuthorizer(store, cache);
  }

  evaluate(userId: string, now: Date): Promise<EntitlementEvaluation> {
    return this.#authorizer.evaluate(userId, now);
  }

  allows(userId: string, capability: string, now: Date): Promise<boolean> {
    return this.#authorizer.allows(userId, capability, now);
  }

  ping(): Promise<void> {
    return this.store.ping();
  }

  async applyEntitlementChange(
    input: ApplyEntitlementChangeInput,
  ): Promise<ApplyEntitlementChangeResult> {
    const userId = input.userId;
    const result = await this.store.applyEntitlementChange(input);
    this.cache.evict(userId);
    return result;
  }
}
