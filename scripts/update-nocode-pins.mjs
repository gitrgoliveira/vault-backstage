#!/usr/bin/env node
/*
 * update-nocode-pins.mjs — pin every Vault no-code module to its latest
 * ingested registry version, preserving variable-options.
 *
 * The no-code update API replaces variable-options wholesale, so each
 * module's options are read first and re-sent verbatim with their ids —
 * this is what keeps the gitlab_instance_name dropdowns alive.
 *
 * Requires the organization to have the `no-code-modules` entitlement;
 * without it HCP Terraform masks the PATCH as a 404. Read-only until the
 * per-module PATCH. Never prints the token.
 *
 * Env: HCP_TF_ORGANIZATION, HCP_TF_TOKEN, HCP_TF_BASE_URL (optional).
 * Run via `make update-nocode-pins` (loads .env), or export the vars.
 */

const org = process.env.HCP_TF_ORGANIZATION;
const token = process.env.HCP_TF_TOKEN;
const baseUrl = process.env.HCP_TF_BASE_URL || 'https://app.terraform.io';

function fail(msg) {
  console.error(`\n✖ ${msg}`);
  process.exit(1);
}
if (!org || org.startsWith('replace-')) fail('HCP_TF_ORGANIZATION is not set (edit .env).');
if (!token || token.startsWith('replace-')) fail('HCP_TF_TOKEN is not set (edit .env).');

const headers = {
  'Content-Type': 'application/vnd.api+json',
  Authorization: `Bearer ${token}`,
};
async function api(path, opts = {}) {
  const res = await fetch(`${baseUrl}${path}`, { headers, ...opts });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${opts.method ?? 'GET'} ${path} -> ${res.status} ${body.slice(0, 200)}`);
  }
  return res.status === 204 ? {} : res.json();
}

const entitlements = await api(`/api/v2/organizations/${org}/entitlement-set`);
if (!entitlements.data?.attributes?.['no-code-modules']) {
  fail(
    `Organization "${org}" does not have the no-code-modules entitlement; ` +
      'HCP Terraform rejects no-code settings updates without it. Existing ' +
      'pins stay as they are until the entitlement is restored.',
  );
}

const registry = [];
for (let page = 1; page < 10; page++) {
  const res = await api(
    `/api/v2/organizations/${org}/registry-modules?filter%5Bprovider%5D=vault&page%5Bsize%5D=100&page%5Bnumber%5D=${page}`,
  );
  registry.push(...(res.data ?? []));
  if (!res.meta?.pagination?.['next-page']) break;
}

let updated = 0;
for (const reg of registry) {
  const name = reg.attributes?.name;
  const ncId = reg.relationships?.['no-code-modules']?.data?.[0]?.id;
  if (!ncId) continue;

  const detail = await api(
    `/api/v2/organizations/${org}/registry-modules/private/${org}/${name}/vault`,
  );
  const versions = (detail.data?.attributes?.['version-statuses'] ?? [])
    .filter(v => v.status === 'ok')
    .map(v => v.version)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const latest = versions[versions.length - 1];
  if (!latest) {
    console.log(`- ${name}: no ingested versions; skipping`);
    continue;
  }

  const nc = await api(`/api/v2/no-code-modules/${ncId}?include=variable_options`);
  const pin = nc.data?.attributes?.['version-pin'];
  if (pin === latest) {
    console.log(`✔ ${name}: already pinned to ${latest}`);
    continue;
  }
  const options = (nc.included ?? [])
    .filter(i => i.type === 'variable-options')
    .map(i => ({
      type: 'variable-options',
      id: i.id,
      attributes: {
        'variable-name': i.attributes['variable-name'],
        'variable-type': i.attributes['variable-type'],
        options: i.attributes.options,
      },
    }));

  // The registry-module relationship is REQUIRED on update (go-tfe
  // RegistryNoCodeModuleUpdateOptions); omitting it makes the API return 404.
  await api(`/api/v2/no-code-modules/${ncId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      data: {
        type: 'no-code-modules',
        attributes: { 'version-pin': latest, enabled: true },
        relationships: {
          'registry-module': {
            data: { id: reg.id, type: 'registry-modules' },
          },
          ...(options.length
            ? { 'variable-options': { data: options } }
            : {}),
        },
      },
    }),
  });
  console.log(
    `✔ ${name}: version-pin ${pin ?? '(latest)'} -> ${latest} (${options.length} variable-option set(s) preserved)`,
  );
  updated += 1;
}
console.log(`\n${updated} no-code module(s) updated.`);
