#!/usr/bin/env node
/*
 * verify-hcptf.mjs — read-only HCP Terraform preflight for the Vault IDP.
 *
 * Validates the team token and auto-resolves the no-code module IDs for every
 * module referenced by the scaffolder templates, using only the org name.
 * Does NOT create/modify/destroy anything. Never prints the token.
 *
 * Env: HCP_TF_ORGANIZATION (required), HCP_TF_TOKEN (required),
 *      HCP_TF_BASE_URL (optional, default https://app.terraform.io)
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const idpRoot = dirname(dirname(fileURLToPath(import.meta.url)));
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

async function api(path) {
  const res = await fetch(`${baseUrl}${path}`, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GET ${path} -> ${res.status} ${body.slice(0, 200)}`);
  }
  return res.json();
}

function candidateNames(name) {
  const n = name.toLowerCase();
  return [
    ...new Set([
      n,
      n.replace(/^terraform-vault-/, ''),
      n.replace(/^terraform-[a-z0-9]+-/, ''),
      n.replace(/^terraform-/, ''),
      n.replace(/^vault-/, ''),
    ]),
  ];
}

// Collect module names referenced by the templates.
const templatesDir = join(idpRoot, 'templates');
const moduleNames = new Set();
for (const d of readdirSync(templatesDir)) {
  const tpl = join(templatesDir, d, 'template.yaml');
  try {
    for (const m of readFileSync(tpl, 'utf8').matchAll(/moduleName:\s*(\S+)/g)) {
      moduleNames.add(m[1]);
    }
  } catch {
    /* skip */
  }
}

async function listAll(path, key = 'data') {
  const out = [];
  let page = 1;
  for (let i = 0; i < 50; i++) {
    const sep = path.includes('?') ? '&' : '?';
    const res = await api(`${path}${sep}page%5Bsize%5D=100&page%5Bnumber%5D=${page}`);
    out.push(...(res[key] ?? []));
    const next = res.meta?.pagination?.['next-page'];
    if (!next) break;
    page = next;
  }
  return out;
}

console.log(`\nHCP Terraform preflight for org "${org}" (${baseUrl})`);

let registry;
try {
  registry = await listAll(`/api/v2/organizations/${org}/registry-modules?filter%5Bprovider%5D=vault`);
} catch (e) {
  fail(`Token/org check failed: ${e.message}`);
}
const noCodeMods = registry.filter(
  m => m.attributes?.['no-code'] === true && m.relationships?.['no-code-modules']?.data?.[0]?.id,
);
console.log(`✔ Token valid. ${registry.length} Vault provider modules, ${noCodeMods.length} no-code enabled.`);

// Discover Vault-tagged projects (Product=Vault) and parse tenant/env from names.
try {
  const tagged = await api(
    `/api/v2/organizations/${org}/projects?filter%5Btagged%5D%5B0%5D%5Bkey%5D=Product&filter%5Btagged%5D%5B0%5D%5Bvalue%5D=Vault&page%5Bsize%5D=100`,
  );
  const names = (tagged.data || []).map(p => p.attributes?.name);
  console.log(`\n✔ ${names.length} Vault-tagged projects (Product=Vault): ${names.join(', ') || '(none)'}`);
  const targets = names
    .map(n => n && n.match(/^([A-Za-z0-9-]+)-Vault-([A-Za-z0-9-]+)$/))
    .filter(Boolean)
    .map(m => `${m[1]}/${m[2]}`);
  console.log(`  Onboarded tenant/env targets: ${targets.join(', ') || '(none)'}`);
} catch (e) {
  console.log(`! Could not list Vault-tagged projects: ${e.message}`);
}

console.log('\nModule resolution:');
let okCount = 0;
for (const name of [...moduleNames].sort()) {
  const cands = candidateNames(name);
  const reg = noCodeMods.find(m => cands.includes(m.attributes?.name));
  if (!reg) {
    console.log(`  ✖ ${name}: no enabled Vault no-code module matched (tried: ${cands.join(', ')})`);
    continue;
  }
  const ncId = reg.relationships['no-code-modules'].data[0].id;
  console.log(`  ✔ ${name} -> ${reg.attributes.name} (vault) -> ${ncId}`);
  okCount += 1;
}

console.log(`\n${okCount}/${moduleNames.size} modules ready for no-code provisioning.`);
if (okCount === 0) process.exit(1);
