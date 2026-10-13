#!/usr/bin/env node
/*
 * backfill-parent-tags.mjs — infer and apply `parent:<name>` tags on existing
 * Vault workspaces so the catalog graph shows the L1 -> L2 -> L3 chain WITHOUT
 * re-provisioning. Mirrors the provider's ingestion filter (Vault-suite module
 * AND Product:Vault-tagged project) and infers each child's parent from the
 * strongest available signal:
 *   - k8s workload  -> trust:       child var cluster_name == cluster-onboarding var cluster_name
 *   - gitlab workload -> trust:     child var gitlab_instance_name == gitlab-onboarding var gitlab_instance_name
 *   - use-case -> workload:         child var entity_id == workload output entity_id
 *                                   (older use-case modules), else the Vault entity
 *                                   name <cluster>-<workload> built from both sides'
 *                                   vars, accepted only when unique; older GitLab KV
 *                                   use-cases fall back to a unique GitLab workload_name
 * Use-case parents are limited to the workload types the L3 template accepts
 * (K8s KV and PostgreSQL roles: Kubernetes; GitLab KV: GitLab; permission groups: either).
 * Parents must be applied (have outputs) and match uniquely; anything else is skipped.
 *
 * Dry-run by default; pass --apply to write the tags. Never prints the token.
 * Env: HCP_TF_ORGANIZATION, HCP_TF_TOKEN, HCP_TF_BASE_URL (optional).
 */
import { layerForModule } from '../plugins/hcp-terraform-backend/src/moduleLayer.ts';

const org = process.env.HCP_TF_ORGANIZATION;
const token = process.env.HCP_TF_TOKEN;
const baseUrl = process.env.HCP_TF_BASE_URL || 'https://app.terraform.io';
const APPLY = process.argv.includes('--apply');

function fail(msg) {
  console.error(`\n\u2716 ${msg}`);
  process.exit(1);
}
if (!org || org.startsWith('replace-')) fail('HCP_TF_ORGANIZATION is not set (edit .env).');
if (!token || token.startsWith('replace-')) fail('HCP_TF_TOKEN is not set (edit .env).');

const headers = {
  'Content-Type': 'application/vnd.api+json',
  Authorization: `Bearer ${token}`,
};

async function api(method, path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`${method} ${path} -> ${res.status} ${t.slice(0, 200)}`);
  }
  return res.status === 204 ? {} : res.json();
}

async function listAll(path) {
  const data = [];
  let page = 1;
  for (let i = 0; i < 50; i++) {
    const sep = path.includes('?') ? '&' : '?';
    const r = await api('GET', `${path}${sep}page%5Bsize%5D=100&page%5Bnumber%5D=${page}`);
    data.push(...(r.data ?? []));
    const next = r.meta?.pagination?.['next-page'];
    if (!next) break;
    page = next;
  }
  return data;
}

const moduleOf = smid => (smid ? (smid.split('/')[2] ?? null) : null);

// Projects (id -> name) and the Product:Vault-tagged project ids.
const projName = new Map();
for (const p of await listAll(`/api/v2/organizations/${org}/projects`)) {
  projName.set(p.id, p.attributes?.name ?? p.id);
}
const taggedIds = new Set(
  (
    await listAll(
      `/api/v2/organizations/${org}/projects` +
        `?filter%5Btagged%5D%5B0%5D%5Bkey%5D=Product&filter%5Btagged%5D%5B0%5D%5Bvalue%5D=Vault`,
    )
  ).map(p => p.id),
);

// Vault-suite workspaces in tagged projects (same rule as the provider).
const wss = (await listAll(`/api/v2/organizations/${org}/workspaces`))
  .map(w => ({
    id: w.id,
    name: w.attributes?.name ?? '',
    project: w.relationships?.project?.data?.id ?? null,
    module: moduleOf(w.attributes?.['source-module-id'] ?? null),
    tags: w.attributes?.['tag-names'] ?? [],
  }))
  .filter(w => {
    const layer = w.module ? layerForModule(w.module) : undefined;
    return layer && (taggedIds.size === 0 || (w.project && taggedIds.has(w.project)));
  });

async function varsOf(id) {
  const r = await api('GET', `/api/v2/workspaces/${id}/vars`);
  const m = {};
  for (const v of r.data ?? []) m[v.attributes?.key] = v.attributes?.value;
  return m;
}
async function outputsOf(id) {
  try {
    const r = await api('GET', `/api/v2/workspaces/${id}/current-state-version-outputs`);
    const m = {};
    for (const o of r.data ?? []) m[o.attributes?.name] = o.attributes?.value;
    return m;
  } catch {
    return {};
  }
}
for (const w of wss) {
  w.layer = layerForModule(w.module);
  w.vars = await varsOf(w.id);
  w.outputs = await outputsOf(w.id);
  w.parentTag = w.tags.find(t => t.startsWith('parent:'))?.slice('parent:'.length);
}

const byProject = new Map();
for (const w of wss) {
  if (!byProject.has(w.project)) byProject.set(w.project, []);
  byProject.get(w.project).push(w);
}

// Vault identity entity name shared by a workload and its use-cases.
const entityNameOf = (scope, vars) =>
  scope && vars['workload_name'] ? `${scope}-${vars['workload_name']}` : undefined;

const K8S_WORKLOAD = 'add-k8s-namespace-access';
const GITLAB_WORKLOAD = 'add-gitlab-project-access';

// Trust module and scope variable each workload module is onboarded under.
const TRUST_FOR_WORKLOAD = {
  [K8S_WORKLOAD]: ['cluster-onboarding', 'cluster_name'],
  [GITLAB_WORKLOAD]: ['gitlab-onboarding', 'gitlab_instance_name'],
};

// Workload modules each use-case accepts as parent, mirroring the L3 template's
// parent pickers: Kubernetes KV and PostgreSQL roles take Kubernetes workloads,
// GitLab KV takes GitLab workloads, permission groups take either.
function parentWorkloadModules(child) {
  if (child.module === 'add-kvv2') {
    return child.vars['integration_type'] === 'gitlab' ? [GITLAB_WORKLOAD] : [K8S_WORKLOAD];
  }
  if (child.module === 'add-pgsql-role') return [K8S_WORKLOAD];
  return [K8S_WORKLOAD, GITLAB_WORKLOAD];
}

// A link is written only when exactly one candidate matches; anything else is
// skipped rather than guessed.
const unique = (list, why) => (list.length === 1 ? { parent: list[0], why } : null);

function inferParent(child, peers) {
  // Only applied workspaces can be parents: a failed or never-applied retry
  // shares the same vars but owns no Vault objects.
  const applied = l =>
    peers.filter(p => p.layer === l && p.id !== child.id && Object.keys(p.outputs).length > 0);
  if (child.layer === 'workload') {
    const trustFor = TRUST_FOR_WORKLOAD[child.module];
    if (!trustFor) return null;
    // Workload modules derive their JWT mount from the trust's scope name, so
    // the trust is the one onboarded with the same cluster / GitLab instance.
    const [trustModule, key] = trustFor;
    const scope = child.vars[key];
    if (!scope) return null;
    return unique(
      applied('trust').filter(t => t.module === trustModule && t.vars[key] === scope),
      `${key}=${scope}`,
    );
  }
  if (child.layer === 'usecase') {
    const accepted = parentWorkloadModules(child);
    const workloads = applied('workload').filter(p => accepted.includes(p.module));
    const eid = child.vars['entity_id'];
    if (eid) {
      // Older use-case modules took the entity id as an input.
      const byEntity = unique(workloads.filter(p => p.outputs['entity_id'] === eid), `entity_id=${eid}`);
      if (byEntity) return byEntity;
    }
    // Current use-case modules look the entity up by <cluster>-<workload>.
    const name = entityNameOf(child.vars['cluster_name'], child.vars);
    const byName = name
      ? unique(
          workloads.filter(p => entityNameOf(p.vars['cluster_name'] ?? p.vars['gitlab_instance_name'], p.vars) === name),
          `entity name=${name}`,
        )
      : null;
    if (byName) return byName;
    // GitLab KV use-cases created before cluster_name was derived from the
    // parent carry a free-text scope, so fall back to the workload name among
    // GitLab workloads only.
    const wn = child.vars['workload_name'];
    if (child.vars['integration_type'] === 'gitlab' && wn) {
      return unique(
        workloads.filter(p => p.vars['workload_name'] === wn),
        `gitlab workload_name=${wn}`,
      );
    }
    return null;
  }
  return null;
}

const actions = [];
for (const [pid, peers] of byProject) {
  for (const child of peers) {
    if (child.layer === 'trust') continue;
    if (child.parentTag) {
      actions.push({ child, parent: null, why: `already tagged parent:${child.parentTag}`, project: projName.get(pid) });
      continue;
    }
    const inf = inferParent(child, peers);
    actions.push({
      child,
      parent: inf?.parent ?? null,
      why: inf?.why ?? 'no confident parent match',
      project: projName.get(pid),
    });
  }
}

console.log(`\nBackfill parent tags for org "${org}" (${APPLY ? 'APPLY' : 'dry-run'})\n`);
const pad = (s, n) => String(s).padEnd(n);
for (const a of actions) {
  if (a.parent) {
    console.log(`${pad(a.child.name, 28)} -> parent:${a.parent.name}   [${a.why}] (${a.project})`);
  } else {
    console.log(`${pad(a.child.name, 28)} -- skip: ${a.why} (${a.project})`);
  }
}
const toApply = actions.filter(a => a.parent);
console.log(`\n${toApply.length} link(s) to write, ${actions.length - toApply.length} skipped.`);

if (!APPLY) {
  console.log('Dry-run only. Re-run with --apply to write the tags.');
  process.exit(0);
}
for (const a of toApply) {
  await api('POST', `/api/v2/workspaces/${a.child.id}/relationships/tags`, {
    data: [{ type: 'tags', attributes: { name: `parent:${a.parent.name}` } }],
  });
  console.log(`\u2714 tagged ${a.child.name} parent:${a.parent.name}`);
}
console.log('\nDone. Restart the IDP (or wait for the 5-min refresh) to see the graph links.');
