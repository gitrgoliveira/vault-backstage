import type { Entity } from '@backstage/catalog-model';
import { nextLayerLink } from './VaultNextLayerCard';

const workspace = (
  name: string,
  annotations: Record<string, string>,
): Entity => ({
  apiVersion: 'backstage.io/v1alpha1',
  kind: 'Resource',
  metadata: {
    name,
    annotations: { 'hcptf.io/target': 'acme-dev', ...annotations },
  },
  spec: { type: 'vault-workspace' },
});

const formDataOf = (href: string) =>
  JSON.parse(decodeURIComponent(href.split('?formData=')[1]));

describe('nextLayerLink', () => {
  it('links an applied cluster trust to the Kubernetes workload form', () => {
    const link = nextLayerLink(
      workspace('trust-c1', {
        'hcptf.io/layer': 'trust',
        'hcptf.io/module-name': 'terraform-vault-cluster-onboarding',
        'hcptf.io/output.cluster_name': 'c1',
      }),
    );
    expect(link.kind).toBe('link');
    if (link.kind !== 'link') return;
    expect(link.href).toMatch(
      /^\/create\/templates\/default\/vault-l2-workload\?/,
    );
    expect(formDataOf(link.href)).toEqual({
      workloadType: 'k8s',
      parentTrustWorkspace: 'resource:default/trust-c1',
      onboardedTarget: 'resource:default/acme-dev',
    });
  });

  it('links an applied GitLab workload to the GitLab KV use-case', () => {
    const link = nextLayerLink(
      workspace('wl-ci', {
        'hcptf.io/layer': 'workload',
        'hcptf.io/module-name': 'terraform-vault-add-gitlab-project-access',
        'hcptf.io/output.workload_name': 'ci',
      }),
    );
    expect(link.kind === 'link' && formDataOf(link.href)).toEqual({
      useCaseType: 'kvv2-gitlab',
      parentGitlabWorkload: 'resource:default/wl-ci',
      onboardedTarget: 'resource:default/acme-dev',
    });
  });

  it('does not offer a parent that has not been applied', () => {
    expect(
      nextLayerLink(
        workspace('trust-c1', {
          'hcptf.io/layer': 'trust',
          'hcptf.io/module-name': 'terraform-vault-cluster-onboarding',
        }),
      ),
    ).toEqual({ kind: 'not-applied', label: 'Create Workload (Layer 2)' });
  });

  it('offers nothing for the L0 tenant-onboarding workspace', () => {
    expect(
      nextLayerLink(
        workspace('tenants', {
          'hcptf.io/layer': 'admin',
          'hcptf.io/module-name': 'terraform-vault-hcptf-onboarding',
        }),
      ),
    ).toEqual({ kind: 'none' });
  });

  it('links an applied PostgreSQL connection to the PostgreSQL role use-case', () => {
    const link = nextLayerLink(
      workspace('pg', {
        'hcptf.io/layer': 'usecase',
        'hcptf.io/module-name': 'terraform-vault-pgsql-onboarding',
        'hcptf.io/output.db_mount_path': 'database/c1',
      }),
    );
    expect(link.kind === 'link' && formDataOf(link.href)).toEqual({
      useCaseType: 'pgsql-role',
      parentPgsqlWorkspace: 'resource:default/pg',
      onboardedTarget: 'resource:default/acme-dev',
    });
  });

  it('marks use-cases as the final layer', () => {
    expect(
      nextLayerLink(
        workspace('kv', {
          'hcptf.io/layer': 'usecase',
          'hcptf.io/module-name': 'terraform-vault-add-kvv2',
        }),
      ),
    ).toEqual({ kind: 'final' });
  });
});
