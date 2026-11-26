import { ContextIdFactory, type ContextId, type ContextIdResolver, type ContextIdStrategy } from '@nestjs/core';
import { z } from 'zod';

/** What durable providers get as `REQUEST`: only what the strategy puts here. */
export interface OrganizationPayload {
  orgId: string | null;
}

const uuid = z.uuid();

/** One DI sub-tree per organization, for the requests of `/orgs/:orgId/...`. */
export class OrganizationContextIdStrategy implements ContextIdStrategy {
  // Least recently used first.
  private readonly trees = new Map<string, { contextId: ContextId; payload: OrganizationPayload }>();

  constructor(private readonly maxTrees = 1_000) {}

  attach(contextId: ContextId, request: { params?: { orgId?: string } }): ContextIdResolver {
    // Runs before every guard, authentication included: this is still the client's input.
    const orgId = request.params?.orgId?.toLowerCase();
    if (!orgId || !uuid.safeParse(orgId).success) {
      // No organization: this request's own sub-tree, durable providers included.
      return { resolve: () => contextId, payload: { orgId: null } };
    }
    let tree = this.trees.get(orgId);
    if (tree) {
      this.trees.delete(orgId); // set again below, as the most recently used
    } else {
      tree = { contextId: ContextIdFactory.create(), payload: { orgId } };
    }
    this.trees.set(orgId, tree);
    if (this.trees.size > this.maxTrees) {
      // Forget the least recently used organization: its instances can be garbage-collected.
      this.trees.delete(this.trees.keys().next().value!);
    }
    const durable = tree.contextId;
    return { resolve: (info) => (info.isTreeDurable ? durable : contextId), payload: tree.payload };
  }
}
