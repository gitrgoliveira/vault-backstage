import { createFrontendModule } from '@backstage/frontend-plugin-api';
import { HomePageWidgetBlueprint } from '@backstage/plugin-home-react/alpha';
import { MarkdownContent } from '@backstage/core-components';

const content = `
Onboard to HashiCorp Vault layer by layer. Each layer is an HCP Terraform
no-code workspace, and each one builds on the one before it.

1. **Tenant (L0, platform team):** [Vault Tenant Onboarding](/create/templates/default/vault-l0-admin-onboarding)
   creates the tenant's Vault namespace and HCP Terraform projects.
2. **Trust (L1):** [Vault Trust Onboarding](/create/templates/default/vault-l1-trust)
   mounts JWT auth for a Kubernetes cluster or a GitLab instance.
3. **Workload (L2):** [Vault Workload Onboarding](/create/templates/default/vault-l2-workload)
   registers a ServiceAccount or GitLab project as a Vault identity.
4. **Use-case (L3):** [Vault Use-case Onboarding](/create/templates/default/vault-l3-usecase)
   grants that workload KV, PostgreSQL or custom ACL access.

From any applied workspace in the [catalog](/catalog), the **Next layer**
card opens the next template with this workspace already selected as the
parent.
`;

const gettingStartedWidget = HomePageWidgetBlueprint.make({
  name: 'getting-started',
  params: {
    name: 'GettingStarted',
    title: 'Getting started with Vault self-service',
    description: 'The onboarding layers and where to start',
    components: async () => ({
      Content: () => <MarkdownContent content={content} />,
    }),
  },
});

export const homeModule = createFrontendModule({
  pluginId: 'home',
  extensions: [gettingStartedWidget],
});
