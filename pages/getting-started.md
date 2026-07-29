# Getting Started

## Prerequisites

Before using the portal, ensure you have:

- Access to the Backstage instance (authenticated via GitLab SSO or guest mode for local dev)
- An HCP Terraform organization with no-code modules published to the private registry
- For **admin onboarding**: HCP TF admin project with Vault credentials variable set
- For **trust/workload/use-case**: A tenant already onboarded via the admin template

## Local development

### 1. Clone and install

```bash
git clone <repo-url>
cd vault-backstage
make install
```

### 2. Configure environment

Copy the example env file and fill in your HCP Terraform token:

```bash
cp .env.example .env
cp app-config.local.yaml.example app-config.local.yaml
# Edit .env with your HCP_TF_TOKEN
```

### 3. Install TechDocs dependencies

```bash
make docs-deps
```

### 4. Start the dev server

```bash
make dev
```

This launches both the Backstage frontend (port 3000) and backend (port 7007). Navigate to `http://localhost:3000`.

### 5. Verify HCP Terraform integration

```bash
make verify-hcptf
```

This validates your token and resolves no-code module IDs.

## First onboarding walkthrough

A typical onboarding sequence follows the [4-layer model](architecture.md):

1. **Admin** creates a tenant via [L0 — Tenant Onboarding](cards/admin-onboarding.md)
2. **Admin** establishes trust via [L1 — Trust Onboarding](cards/trust-onboarding.md)
3. **App team** registers their workload via [L2 — Workload Onboarding](cards/workload-onboarding.md)
4. **App team** requests secret access via [L3 — Use-case Onboarding](cards/usecase-onboarding.md)

Each step produces an HCP Terraform workspace and a Backstage catalog entity. Later steps reference earlier ones through the entity picker fields in the form.

## Generating docs and module inventory

```bash
make generate
```

This runs `terraform-docs` against each module, producing:

- TechDocs sites under `docs/<module>/` for the Backstage Docs tab
- Variable inventories under `generated/variables/<module>.json`
