import { Config } from '@backstage/config';
import { LoggerService } from '@backstage/backend-plugin-api';

/** HCP TF run statuses that mean the run finished successfully. */
const RUN_TERMINAL_SUCCESS = new Set(['applied', 'planned_and_finished']);
/** HCP TF run statuses that mean the run failed and will not apply. */
const RUN_TERMINAL_FAILURE = new Set([
  'errored',
  'canceled',
  'force_canceled',
  'discarded',
  'policy_override', // soft-mandatory policy failed; blocks auto-apply
]);
/** Plan-complete statuses that are terminal only when auto-apply is disabled. */
const RUN_AWAITING_APPLY = new Set([
  'planned',
  'cost_estimated',
  'policy_checked',
  'post_plan_awaiting_decision',
]);

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** Final state of an HCP TF run that the portal waited on. */
export interface RunResult {
  runId: string;
  status: string;
  runUrl: string;
}

/** Variable entry to pass to HCP TF workspace. */
export interface TfVar {
  key: string;
  value: string;
  category: 'terraform' | 'env';
  hcl: boolean;
  sensitive: boolean;
  description?: string;
}

export interface CreateWorkspaceOptions {
  workspaceName: string;
  noCodModuleId: string;
  vars: TfVar[];
  projectId?: string;
  /** Backstage user name for attribution */
  requestedBy?: string;
  autoApply?: boolean;
}

export interface CreateWorkspaceResult {
  workspaceId: string;
  workspaceUrl: string;
  workspaceName: string;
}

export interface WorkspaceOutput {
  key: string;
  value: unknown;
  sensitive: boolean;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  status: string;
  sourceModuleId: string | null;
  tagNames: string[];
  projectId: string | null;
  /** Current state-version id; changes only when a new state (outputs) is created. */
  currentStateVersionId: string | null;
}

/** Client for the HCP Terraform no-code provisioning APIs. */
export class HcpTfClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly organization: string;
  private readonly logger: LoggerService;
  /** Cache of moduleName -> nocode-module-id resolved from config or API. */
  private moduleIdCache: Map<string, string> = new Map();
  /** Cache of project name -> project-id. */
  private projectIdCache: Map<string, string> = new Map();
  /** Template for deriving the tenant project name; {tenant} and {env} placeholders. */
  private readonly projectNamingPattern: string;
  /** Tag-binding marking a project as a Vault onboarding project. */
  private readonly productTagKey: string;
  private readonly productTagValue: string;
  /** Cache of Vault-tagged projects [{id, name}]. */
  private vaultProjectsCache?: { id: string; name: string }[];
  /** Cache of the Vault no-code module list (registry sweep is expensive). */
  private vaultNoCodeModulesCache?: { name: string; nocodeId: string; versionTags?: string[] }[];
  /** Cache of workspaceId -> {stateVersionId, outputs}; avoids refetching unchanged outputs. */
  private outputsCache: Map<
    string,
    { stateVersionId: string; outputs: WorkspaceOutput[] }
  > = new Map();
  /** Admin project (holds tenant-onboarding workspaces) name and optional id. */
  private readonly adminProjectName: string;
  private readonly adminProjectId?: string;
  private adminProjectIdCache?: string;

  constructor(config: Config, logger: LoggerService) {
    const cfg = config.getConfig('hcpTerraform');
    this.organization = cfg.getString('organization');
    this.baseUrl = cfg.getOptionalString('baseUrl') ?? 'https://app.terraform.io';
    this.token = cfg.getString('token');
    this.logger = logger;
    const projectsCfg = cfg.getOptionalConfig('projects');
    this.projectNamingPattern =
      projectsCfg?.getOptionalString('namingPattern') ?? '{tenant}-Vault-{env}';
    const tagCfg = projectsCfg?.getOptionalConfig('productTag');
    this.productTagKey = tagCfg?.getOptionalString('key') ?? 'Product';
    this.productTagValue = tagCfg?.getOptionalString('value') ?? 'Vault';
    this.adminProjectName =
      projectsCfg?.getOptionalString('adminProjectName') ?? 'HCP Vault Admin';
    this.adminProjectId = projectsCfg?.getOptionalString('adminProjectId');

    // Pre-populate cache from static moduleMap config
    const moduleMap = cfg.getOptional<Record<string, string>>('moduleMap');
    if (moduleMap) {
      for (const [name, id] of Object.entries(moduleMap)) {
        this.moduleIdCache.set(name, id);
      }
    }
  }

  /** Compute the tenant project name for a tenant/environment. */
  projectNameFor(tenant: string, env: string): string {
    return this.projectNamingPattern
      .replace('{tenant}', tenant)
      .replace('{env}', env);
  }

  /** The configured tenant project naming pattern (for diagnostics/logging). */
  get namingPattern(): string {
    return this.projectNamingPattern;
  }

  /**
   * List HCP TF projects tagged as Vault onboarding projects
   * (productTag.key=productTag.value, default Product=Vault). Cached per process.
   */
  async listVaultProjects(): Promise<{ id: string; name: string }[]> {
    if (this.vaultProjectsCache) return this.vaultProjectsCache;
    const { data } = await this.requestAllPages(
      `/api/v2/organizations/${this.organization}/projects` +
        `?filter%5Btagged%5D%5B0%5D%5Bkey%5D=${encodeURIComponent(this.productTagKey)}` +
        `&filter%5Btagged%5D%5B0%5D%5Bvalue%5D=${encodeURIComponent(this.productTagValue)}`,
    );
    const projects = data.map((p: any) => ({
      id: p.id as string,
      name: p.attributes?.name as string,
    }));
    this.vaultProjectsCache = projects;
    return projects;
  }

  /**
   * Resolve the admin project id (holds the tenant-onboarding workspaces).
   * Uses the explicit adminProjectId if configured, else resolves by name.
   */
  private async resolveAdminProjectId(): Promise<string> {
    if (this.adminProjectId) return this.adminProjectId;
    if (this.adminProjectIdCache) return this.adminProjectIdCache;
    const id = await this.resolveProjectByName(this.adminProjectName);
    this.adminProjectIdCache = id;
    return id;
  }

  private asStringMap(value: unknown): Record<string, string> | undefined {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, string>;
    }
    return undefined;
  }

  /** Derive the tenant name from a `<tenant>-Vault-<env>` project name. */
  private tenantFromProjectName(name: string, env: string): string | undefined {
    const suffix = this.projectNamingPattern.replace('{tenant}', '').replace('{env}', env);
    if (suffix && name.endsWith(suffix)) {
      return name.slice(0, name.length - suffix.length) || undefined;
    }
    return undefined;
  }

  /** Derive the tenant from a Vault namespace like `admin/<env>/<tenant>`. */
  private tenantFromNamespace(ns?: string): string | undefined {
    if (!ns) return undefined;
    const parts = ns.split('/').filter(Boolean);
    return parts.length ? parts[parts.length - 1] : undefined;
  }

  /**
   * Discover onboarded tenant/environment targets from the tenant-onboarding
   * workspaces in the admin project. Each such workspace
   * (terraform-vault-hcptf-onboarding) outputs `project_ids` and
   * `project_names` maps keyed by environment, which are the authoritative
   * record of the per-environment tenant projects that were created.
   */
  async discoverOnboardedTargets(): Promise<
    { tenant: string; env: string; projectId: string; name: string }[]
  > {
    let adminProjectId: string;
    try {
      adminProjectId = await this.resolveAdminProjectId();
    } catch (err: any) {
      this.logger.warn(
        `Cannot resolve admin project "${this.adminProjectName}" for tenant discovery: ${err.message}`,
      );
      return [];
    }

    const workspaces = await this.listWorkspaces(adminProjectId);
    const onboarding = workspaces.filter(w =>
      (w.sourceModuleId ?? '').includes('hcptf-onboarding'),
    );

    const out: { tenant: string; env: string; projectId: string; name: string }[] = [];
    const seen = new Set<string>();
    for (const ws of onboarding) {
      let outputs: WorkspaceOutput[];
      try {
        outputs = await this.readOutputsCached(ws.id, ws.currentStateVersionId);
      } catch {
        continue; // workspace may not have applied yet
      }
      const projectIds = this.asStringMap(outputs.find(o => o.key === 'project_ids')?.value);
      if (!projectIds) continue;
      const projectNames = this.asStringMap(outputs.find(o => o.key === 'project_names')?.value);
      const namespaces = this.asStringMap(outputs.find(o => o.key === 'vault_namespaces')?.value);

      for (const [env, projectId] of Object.entries(projectIds)) {
        if (!projectId || seen.has(projectId)) continue;
        seen.add(projectId);
        const name = projectNames?.[env] ?? this.projectNameFor(ws.name, env);
        const tenant =
          this.tenantFromProjectName(name, env) ??
          this.tenantFromNamespace(namespaces?.[env]) ??
          ws.name;
        out.push({ tenant, env, projectId, name });
      }
    }
    return out;
  }

  /**
   * Resolve an HCP TF project id by its exact name. Prefers projects tagged
   * as Vault onboarding projects; falls back to a name-only lookup (with a
   * warning) so untagged-but-valid projects still resolve.
   */
  async resolveProjectByName(name: string): Promise<string> {
    const cached = this.projectIdCache.get(name);
    if (cached) return cached;

    // Primary: among Vault-tagged projects.
    const tagged = await this.listVaultProjects().catch(() => []);
    const taggedMatch = tagged.find(p => p.name === name);
    if (taggedMatch) {
      this.projectIdCache.set(name, taggedMatch.id);
      this.logger.info(`Resolved Vault project "${name}" -> ${taggedMatch.id}`);
      return taggedMatch.id;
    }

    // Fallback: exact name lookup (project may not be tagged yet).
    const res = await this.request<any>(
      'GET',
      `/api/v2/organizations/${this.organization}/projects?filter%5Bnames%5D=${encodeURIComponent(name)}`,
    );
    const match = (res.data ?? []).find((p: any) => p.attributes?.name === name);
    if (!match) {
      throw new Error(
        `HCP Terraform project "${name}" was not found in org "${this.organization}".`,
      );
    }
    this.logger.warn(
      `Project "${name}" is not tagged ${this.productTagKey}=${this.productTagValue}; ` +
        `resolving by name. Consider tagging it to mark it as a Vault project.`,
    );
    this.projectIdCache.set(name, match.id);
    return match.id;
  }

  /**
   * Resolve the HCP TF project id for a tenant/environment. The tenant project
   * (created by terraform-vault-hcptf-onboarding) carries the Vault dynamic-
   * credentials variable set, so every self-service workspace MUST land in it.
   * Throws a clear error if the tenant has not been onboarded.
   */
  async resolveProjectId(tenant: string, env: string): Promise<string> {
    const name = this.projectNameFor(tenant, env);
    try {
      return await this.resolveProjectByName(name);
    } catch {
      throw new Error(
        `HCP Terraform project "${name}" was not found. Tenant "${tenant}" / env "${env}" ` +
          `has not been onboarded — run the admin tenant onboarding first.`,
      );
    }
  }


  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/vnd.api+json',
      Authorization: `Bearer ${this.token}`,
    };
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const maxRetries = 4;
    let res!: Response;
    for (let attempt = 0; ; attempt++) {
      res = await fetch(url, {
        method,
        headers: this.headers(),
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      // Retry on rate limiting (429) and transient server errors (>=500).
      if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
        const retryAfter = Number(res.headers.get('retry-after'));
        const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : Math.min(1000 * 2 ** attempt, 8000);
        this.logger.warn(
          `HCP TF API ${method} ${path} -> ${res.status}; retrying in ${delayMs}ms ` +
            `(attempt ${attempt + 1}/${maxRetries}).`,
        );
        await new Promise(resolve => setTimeout(resolve, delayMs));
        continue;
      }
      break;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `HCP TF API ${method} ${path} failed [${res.status}]: ${text}`,
      );
    }
    if (res.status === 204) return {} as T;
    return res.json() as Promise<T>;
  }

  /**
   * Build candidate registry module names for a requested module name.
   * The HCP TF registry stores the standard-parsed short name (repo
   * `terraform-<provider>-<name>` -> name `<name>`), so we try the original
   * plus progressively stripped variants.
   */
  private candidateNames(moduleName: string): string[] {
    const n = moduleName.toLowerCase();
    const variants = new Set<string>([n]);
    variants.add(n.replace(/^terraform-vault-/, ''));
    variants.add(n.replace(/^terraform-[a-z0-9]+-/, ''));
    variants.add(n.replace(/^terraform-/, ''));
    variants.add(n.replace(/^vault-/, ''));
    return [...variants];
  }

  /**
   * GET a JSON:API collection, following `next-page` links so callers never
   * silently truncate at the first 100 results. Aggregates sideloaded
   * `included` resources across pages for callers that use `?include=`.
   */
  private async requestAllPages(path: string): Promise<{ data: any[]; included: any[] }> {
    const sep = path.includes('?') ? '&' : '?';
    const data: any[] = [];
    const included: any[] = [];
    let page = 1;
    for (let i = 0; i < 100; i++) {
      const res = await this.request<any>(
        'GET',
        `${path}${sep}page%5Bsize%5D=100&page%5Bnumber%5D=${page}`,
      );
      data.push(...(res.data ?? []));
      if (Array.isArray(res.included)) included.push(...res.included);
      const next = res.meta?.pagination?.['next-page'];
      if (!next) break;
      page = next;
    }
    return { data, included };
  }

  /**
   * List all registry modules for the Vault provider (filter[provider]=vault).
   * Each item carries no-code info inline: attributes['no-code'] and the
   * `no-code-modules` relationship with the nocode-xxx id.
   */
  private async listVaultRegistryModules(): Promise<any[]> {
    const { data } = await this.requestAllPages(
      `/api/v2/organizations/${this.organization}/registry-modules?filter%5Bprovider%5D=vault`,
    );
    return data;
  }

  /**
   * List all Vault no-code modules with their nocode-xxx ids, in a single
   * targeted call. This is the authoritative set the portal can provision.
   */
  async listVaultNoCodeModules(): Promise<{ name: string; nocodeId: string; versionTags?: string[] }[]> {
    if (this.vaultNoCodeModulesCache) return this.vaultNoCodeModulesCache;
    const mods = await this.listVaultRegistryModules();
    this.vaultNoCodeModulesCache = mods
      .filter(
        m =>
          m.attributes?.['no-code'] === true &&
          m.relationships?.['no-code-modules']?.data?.[0]?.id,
      )
      .map(m => ({
        name: m.attributes.name,
        nocodeId: m.relationships['no-code-modules'].data[0].id,
        versionTags: m.attributes?.['version-tags'],
      }));
    return this.vaultNoCodeModulesCache;
  }

  /**
   * Resolve a module name to its no-code-module id (nocode-xxx), fully
   * automatically from the org via the Vault no-code module list.
   * Order: in-memory cache (incl. optional moduleMap override) -> live lookup.
   */
  async resolveNoCodModuleId(moduleName: string): Promise<string> {
    const cached = this.moduleIdCache.get(moduleName);
    if (cached) return cached;

    this.logger.info(`Resolving no-code module ID for "${moduleName}" from org ${this.organization}`);

    const candidates = this.candidateNames(moduleName);
    const ncMods = await this.listVaultNoCodeModules();
    const match = ncMods.find(m => candidates.includes(m.name));

    if (!match) {
      const available = ncMods.map(m => m.name).join(', ') || '(none)';
      throw new Error(
        `"${moduleName}" is not an enabled Vault no-code module in org "${this.organization}". ` +
          `Tried names: ${candidates.join(', ')}. Available Vault no-code modules: ${available}.`,
      );
    }

    this.moduleIdCache.set(moduleName, match.nocodeId);
    this.logger.info(`Resolved "${moduleName}" -> "${match.name}" -> ${match.nocodeId}`);
    return match.nocodeId;
  }

  /**
   * Read-only preflight: validates the token and resolves the no-code IDs for
   * the given module names. Returns a per-module report. Never throws on a
   * single module; collects errors instead.
   */
  async preflight(moduleNames: string[]): Promise<{
    organization: string;
    results: { module: string; status: 'ok' | 'error'; nocodeId?: string; error?: string }[];
  }> {
    const results: { module: string; status: 'ok' | 'error'; nocodeId?: string; error?: string }[] = [];
    for (const name of moduleNames) {
      try {
        const id = await this.resolveNoCodModuleId(name);
        results.push({ module: name, status: 'ok', nocodeId: id });
      } catch (err: any) {
        results.push({ module: name, status: 'error', error: err.message });
      }
    }
    return { organization: this.organization, results };
  }

  /** Create a new no-code workspace. Returns workspace ID and URL. */
  async createWorkspace(opts: CreateWorkspaceOptions): Promise<CreateWorkspaceResult> {
    const {
      workspaceName,
      noCodModuleId,
      vars,
      projectId,
      requestedBy = 'unknown',
      autoApply = true,
    } = opts;

    const payload: any = {
      data: {
        type: 'workspaces',
        attributes: {
          name: workspaceName,
          auto_apply: autoApply,
          'source-name': 'Vault IDP',
          'source-url': 'https://backstage',
          description: `Managed by Vault IDP. Requested by: ${requestedBy}`,
        },
        relationships: {
          vars: {
            data: vars.map(v => ({
              type: 'vars',
              attributes: {
                key: v.key,
                value: v.value,
                category: v.category,
                hcl: v.hcl,
                sensitive: v.sensitive,
                description: v.description ?? '',
              },
            })),
          },
        },
      },
    };

    if (projectId) {
      payload.data.relationships.project = {
        data: { id: projectId, type: 'project' },
      };
    }

    const res = await this.request<any>(
      'POST',
      `/api/v2/no-code-modules/${noCodModuleId}/workspaces`,
      payload,
    );

    const wsId: string = res.data.id;
    const wsName: string = res.data.attributes?.name ?? workspaceName;
    const wsUrl = this.workspaceUrl(wsName);

    this.logger.info(`Created HCP TF workspace ${wsId} (${wsName})`);
    return { workspaceId: wsId, workspaceName: wsName, workspaceUrl: wsUrl };
  }

  /** Build the canonical UI URL for a workspace by name. */
  workspaceUrl(name: string): string {
    return `${this.baseUrl}/app/${this.organization}/workspaces/${name}`;
  }

  /** Build the canonical UI URL for a run. */
  runUrl(runId: string): string {
    return `${this.baseUrl}/app/${this.organization}/runs/${runId}`;
  }

  /** Get the most recent run for a workspace (HCP TF returns newest first). */
  async getLatestRun(workspaceId: string): Promise<{ id: string; status: string } | null> {
    const res = await this.request<any>(
      'GET',
      `/api/v2/workspaces/${workspaceId}/runs?page%5Bsize%5D=1`,
    );
    const run = (res.data ?? [])[0];
    if (!run) return null;
    return { id: run.id, status: run.attributes?.status ?? 'unknown' };
  }

  /** Get a single run's current status. */
  async getRun(runId: string): Promise<{ id: string; status: string }> {
    const res = await this.request<any>('GET', `/api/v2/runs/${runId}`);
    return { id: res.data.id, status: res.data.attributes?.status ?? 'unknown' };
  }

  /**
   * Wait for the run created by no-code provisioning to reach a terminal state.
   * Throws if the run errors, is canceled/discarded, or blocks on a policy
   * override, so the caller (scaffolder step) fails instead of going green.
   * When auto-apply is disabled, a successful plan awaiting manual apply is
   * treated as success (not a failure).
   */
  async waitForRun(
    workspaceId: string,
    opts: {
      autoApply: boolean;
      timeoutMs?: number;
      pollIntervalMs?: number;
      onStatus?: (status: string, runUrl: string) => void;
    },
  ): Promise<RunResult> {
    const timeoutMs = opts.timeoutMs ?? 20 * 60 * 1000;
    const pollIntervalMs = opts.pollIntervalMs ?? 5000;
    const deadline = Date.now() + timeoutMs;

    // The no-code run is queued asynchronously; wait for it to appear.
    let run = await this.getLatestRun(workspaceId);
    while (!run && Date.now() < deadline) {
      await sleep(pollIntervalMs);
      run = await this.getLatestRun(workspaceId);
    }
    if (!run) {
      throw new Error(
        `No HCP Terraform run was created for workspace ${workspaceId} within the timeout.`,
      );
    }

    const runUrl = this.runUrl(run.id);
    let lastStatus = '';
    while (Date.now() < deadline) {
      const { status } = await this.getRun(run.id);
      if (status !== lastStatus) {
        opts.onStatus?.(status, runUrl);
        lastStatus = status;
      }
      if (RUN_TERMINAL_SUCCESS.has(status)) {
        return { runId: run.id, status, runUrl };
      }
      if (RUN_TERMINAL_FAILURE.has(status)) {
        throw new Error(
          `HCP Terraform run did not succeed (status: ${status}). Review the run at ${runUrl}`,
        );
      }
      if (!opts.autoApply && RUN_AWAITING_APPLY.has(status)) {
        // Plan succeeded; manual apply required by design. Not a failure.
        return { runId: run.id, status, runUrl };
      }
      await sleep(pollIntervalMs);
    }
    throw new Error(
      `Timed out after ${Math.round(timeoutMs / 60000)}m waiting for HCP Terraform run ${run.id} ` +
        `(workspace ${workspaceId}) to finish. Last status: ${lastStatus || 'unknown'}. See ${runUrl}`,
    );
  }


  /** Read current state version outputs for a workspace. */
  async readOutputs(workspaceId: string): Promise<WorkspaceOutput[]> {
    const res = await this.request<any>(
      'GET',
      `/api/v2/workspaces/${workspaceId}/current-state-version-outputs`,
    );
    const data: any[] = res.data ?? [];
    return data.map((o: any) => ({
      key: o.attributes?.name ?? o.id,
      value: o.attributes?.value,
      sensitive: o.attributes?.sensitive ?? false,
    }));
  }

  /**
   * Read outputs with a per-workspace cache keyed by the current state-version
   * id. The state version changes only when a new state (and thus new outputs)
   * is created, so unchanged workspaces are served from cache with no API call.
   * Workspaces with no state version (never applied) return [] without a call.
   */
  async readOutputsCached(
    workspaceId: string,
    stateVersionId: string | null,
  ): Promise<WorkspaceOutput[]> {
    if (!stateVersionId) return [];
    const cached = this.outputsCache.get(workspaceId);
    if (cached && cached.stateVersionId === stateVersionId) {
      return cached.outputs;
    }
    const outputs = await this.readOutputs(workspaceId);
    this.outputsCache.set(workspaceId, { stateVersionId, outputs });
    return outputs;
  }

  /**
   * Add plain tag names to a workspace (e.g. `parent:foo`). Used to record the
   * previous-layer workspace so the catalog can render the L1 -> L2 -> L3 chain.
   */
  async addWorkspaceTags(workspaceId: string, tags: string[]): Promise<void> {
    if (tags.length === 0) return;
    await this.request<any>(
      'POST',
      `/api/v2/workspaces/${workspaceId}/relationships/tags`,
      { data: tags.map(name => ({ type: 'tags', attributes: { name } })) },
    );
  }

  /** Queue a destroy run on a workspace. */
  async createDestroyRun(workspaceId: string, message: string): Promise<{ runId: string; runUrl: string }> {
    const payload = {
      data: {
        type: 'runs',
        attributes: {
          'is-destroy': true,
          message,
        },
        relationships: {
          workspace: {
            data: { id: workspaceId, type: 'workspaces' },
          },
        },
      },
    };

    const res = await this.request<any>('POST', '/api/v2/runs', payload);
    const runId: string = res.data.id;
    const runUrl = this.runUrl(runId);
    return { runId, runUrl };
  }

  /** List workspaces for the org, optionally filtered by project. */
  async listWorkspaces(projectId?: string): Promise<WorkspaceSummary[]> {
    // include=current_run sideloads the run so we can surface real status
    // (the `latest-run` attribute does not exist; it is a relationship).
    let path = `/api/v2/organizations/${this.organization}/workspaces?include=current_run`;
    if (projectId) path += `&filter%5Bproject%5D%5Bid%5D=${encodeURIComponent(projectId)}`;

    const { data, included } = await this.requestAllPages(path);
    const runStatusById = new Map<string, string>();
    for (const r of included) {
      if (r.type === 'runs') runStatusById.set(r.id, r.attributes?.status ?? 'unknown');
    }
    return data.map((w: any) => {
      const runId = w.relationships?.['current-run']?.data?.id;
      return {
        id: w.id,
        name: w.attributes?.name ?? '',
        status: (runId && runStatusById.get(runId)) || 'unknown',
        sourceModuleId: w.attributes?.['source-module-id'] ?? null,
        tagNames: w.attributes?.['tag-names'] ?? [],
        projectId: w.relationships?.project?.data?.id ?? null,
        currentStateVersionId:
          w.relationships?.['current-state-version']?.data?.id ?? null,
      };
    });
  }
}
