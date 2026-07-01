import { createBackendModule } from '@backstage/backend-plugin-api';
import { policyExtensionPoint } from '@backstage/plugin-permission-node/alpha';
import {
  PolicyDecision,
  AuthorizeResult,
  isResourcePermission,
} from '@backstage/plugin-permission-common';
import {
  PermissionPolicy,
  PolicyQuery,
  PolicyQueryUser,
} from '@backstage/plugin-permission-node';
import {
  catalogConditions,
  createCatalogConditionalDecision,
} from '@backstage/plugin-catalog-backend/alpha';

/**
 * VaultIdpPermissionPolicy
 *
 * Owner-gated policy for the Vault Self-Service Portal:
 * - Deleting/unregistering a catalog entity (which includes provisioned
 *   vault-workspace Resources) is restricted to members of the owning group.
 * - Everything else is allowed.
 *
 * Ownership is evaluated via the catalog `isEntityOwner` rule using the
 * signed-in user's ownership entity refs, so a tenant can only destroy the
 * workspaces owned by their own group.
 */
export class VaultIdpPermissionPolicy implements PermissionPolicy {
  async handle(
    request: PolicyQuery,
    user?: PolicyQueryUser,
  ): Promise<PolicyDecision> {
    if (
      isResourcePermission(request.permission, 'catalog-entity') &&
      request.permission.name === 'catalog.entity.delete'
    ) {
      return createCatalogConditionalDecision(request.permission, {
        anyOf: [
          catalogConditions.isEntityOwner({
            claims: user?.info.ownershipEntityRefs ?? [],
          }),
        ],
      });
    }

    return { result: AuthorizeResult.ALLOW };
  }
}

/**
 * Backend module that installs VaultIdpPermissionPolicy. Replaces the default
 * allow-all policy.
 */
export const vaultIdpPermissionModule = createBackendModule({
  pluginId: 'permission',
  moduleId: 'vault-idp-policy',
  register(reg) {
    reg.registerInit({
      deps: { policy: policyExtensionPoint },
      async init({ policy }) {
        policy.setPolicy(new VaultIdpPermissionPolicy());
      },
    });
  },
});
