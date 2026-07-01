export interface Config {
  hcpTerraform: {
    /** HCP Terraform organization name. */
    organization: string;
    /** HCP Terraform base URL. Defaults to https://app.terraform.io. */
    baseUrl?: string;
    /**
     * HCP Terraform team token (onboarding team). Must have rights to create
     * no-code workspaces. Never exposed to the frontend.
     * @visibility secret
     */
    token: string;
    projects?: {
      /**
       * Template for deriving the HCP TF project name from tenant/env.
       * Uses literal {tenant} and {env} as placeholders (NOT ${...}, which
       * Backstage would treat as an env-var reference).
       * Default: {tenant}-Vault-{env} (matches terraform-vault-hcptf-onboarding).
       */
      namingPattern?: string;
      /** Tag key used to identify the tenant on workspaces. Default: tenant */
      tenantTagKey?: string;
      /** List of environment names. Default: [dev, test, prod] */
      environments?: string[];
      /**
       * Name of the HCP TF admin project that holds the tenant-onboarding
       * workspaces (terraform-vault-hcptf-onboarding). Onboarded tenants are
       * discovered from those workspaces' project_ids / project_names outputs.
       * Default: "HCP Vault Admin".
       */
      adminProjectName?: string;
      /**
       * Explicit admin project ID (prj-xxxx). Overrides adminProjectName when
       * set; useful if the project name is ambiguous.
       */
      adminProjectId?: string;
      /**
       * Tag-binding that marks an HCP TF project as a Vault onboarding project.
       * Used to discover/validate tenant projects. Default key=Product value=Vault.
       */
      productTag?: {
        key?: string;
        value?: string;
      };
    };
    audit?: {
      /** Tag/message key for user attribution. Default: requested-by */
      requestedByTagKey?: string;
    };
    /**
     * Optional override map of module name -> no-code module ID (nocode-xxx).
     * If a module is not listed here the client will attempt API resolution.
     * Example: { "terraform-vault-cluster-onboarding": "nocode-abc123" }
     */
    moduleMap?: {
      [moduleName: string]: string;
    };
    actions?: {
      /**
       * Register the hcptf:run:create destroy action. It queues a destroy run
       * on any workspace by ID and performs NO ownership check, so it is
       * disabled by default. Only enable it once you wire it into a template
       * that gates destruction to the workspace owner. Default: false.
       */
      enableDestroy?: boolean;
    };
  };
}
