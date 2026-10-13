#!/usr/bin/env node
/*
 * backfill-parent-tags.mjs — infer and apply `parent:<name>` tags on existing
 * Vault workspaces so the catalog graph shows the L1 -> L2 -> L3 chain WITHOUT
 * re-provisioning. Mirrors the provider's ingestion filter (Vault-suite module
 * AND Product:Vault-tagged project) and infers each child's parent from the
 * strongest available signal:
 *   - k8s workload  -> trust:       child var cluster_name == cluster-onboarding var cluster_name
 *   - gitlab workload -> trust:     child var gitlab_instance_name == gitlab-onboarding var
 *   - use-case -> workload:         child var entity_id == workload output entity_id
 *                                   (older use-case modules), else the Vault entity
 *                                   name <cluster>-<workload> built from both sides'
 *                                   vars, accepted only when unique
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

function inferParent(child, peers) {
  const others = l => peers.filter(p => p.layer === l && p.id !== child.id);
  if (child.layer === 'workload') {
    const trusts = others('trust');
    // Workload modules derive their JWT mount from the trust's scope name, so
    // the trust is the one onboarded with the same cluster / GitLab instance.
    const [trustModule, key] =
      child.module === 'add-k8s-namespace-access'
        ? ['cluster-onboarding', 'cluster_name']
        : ['gitlab-onboarding', 'gitlab_instance_name'];
    const scope = child.vars[key];
    const m = scope && trusts.find(t => t.module === trustModule && t.vars[key] === scope);
    if (m) return { parent: m, why: `${key}=${scope}` };
    return null;
  }
  if (child.layer === 'usecase') {
    const workloads = others('workload');
    const eid = child.vars['entity_id'];
    const byEntity = eid ? workloads.find(p => p.outputs['entity_id'] === eid) : undefined;
    if (byEntity) return { parent: byEntity, why: `entity_id=${eid}` };
    // Current use-case modules have no entity_id input; they look the entity up
    // by name, so match on that same <cluster>-<workload> name.
    const name = entityNameOf(child.vars['cluster_name'], child.vars);
    const byName = name
      ? workloads.filter(p => entityNameOf(p.vars['cluster_name'] ?? p.vars['gitlab_instance_name'], p.vars) === name)
      : [];
    if (byName.length === 1) return { parent: byName[0], why: `entity name=${name}` };
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
