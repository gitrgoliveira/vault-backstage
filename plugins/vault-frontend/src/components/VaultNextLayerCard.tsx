import { Link as RouterLink } from 'react-router-dom';
import type { Entity } from '@backstage/catalog-model';
import { useEntity } from '@backstage/plugin-catalog-react';
import { InfoCard } from '@backstage/core-components';
import { Button, Typography } from '@material-ui/core';
import ArrowForwardIcon from '@material-ui/icons/ArrowForward';
import { LAYER_ANNOTATION } from './layer';

type NextStep = {
  template: string;
  label: string;
  /** Form fields to pre-fill; the parent field receives this workspace. */
  formData: Record<string, string>;
  parentField: string;
  /** Output the next template reads from this workspace; absent until applied. */
  requiredOutput: string;
};

// Keyed by module rather than layer: the next template's parent pickers only
// accept these modules, and each reads a specific output from the parent.
const NEXT_BY_MODULE: Record<string, NextStep> = {
  'terraform-vault-cluster-onboarding': {
    template: 'vault-l2-workload',
    label: 'Create Workload (Layer 2)',
    formData: { workloadType: 'k8s' },
    parentField: 'parentTrustWorkspace',
    requiredOutput: 'cluster_name',
  },
  'terraform-vault-gitlab-onboarding': {
    template: 'vault-l2-workload',
    label: 'Create Workload (Layer 2)',
    formData: { workloadType: 'gitlab' },
    parentField: 'parentGitlabTrust',
    requiredOutput: 'gitlab_instance_name',
  },
  'terraform-vault-add-k8s-namespace-access': {
    template: 'vault-l3-usecase',
    label: 'Create Use-case (Layer 3)',
    formData: { useCaseType: 'kvv2' },
    parentField: 'parentWorkloadWorkspace',
    requiredOutput: 'workload_name',
  },
  'terraform-vault-add-gitlab-project-access': {
    template: 'vault-l3-usecase',
    label: 'Create Use-case (Layer 3)',
    formData: { useCaseType: 'kvv2-gitlab' },
    parentField: 'parentGitlabWorkload',
    requiredOutput: 'workload_name',
  },
  // A PostgreSQL connection is a use-case-layer workspace that is itself the
  // parent of PostgreSQL role use-cases.
  'terraform-vault-pgsql-onboarding': {
    template: 'vault-l3-usecase',
    label: 'Create PostgreSQL role (Layer 3)',
    formData: { useCaseType: 'pgsql-role' },
    parentField: 'parentPgsqlWorkspace',
    requiredOutput: 'db_mount_path',
  },
};

export type NextLayerLink =
  | { kind: 'link'; label: string; href: string }
  | { kind: 'not-applied'; label: string }
  | { kind: 'final' }
  | { kind: 'none' };

/**
 * Decides what the "Next layer" card offers for a vault-workspace. The link
 * pre-selects this workspace as the parent, so it is only offered when the
 * next template's parent picker would accept it: a supported module that has
 * been applied (its required output is published as an annotation).
 */
export function nextLayerLink(entity: Entity): NextLayerLink {
  const ann = entity.metadata.annotations ?? {};
  const next = NEXT_BY_MODULE[ann['hcptf.io/module-name'] ?? ''];
  if (!next) {
    return ann[LAYER_ANNOTATION] === 'usecase' ? { kind: 'final' } : { kind: 'none' };
  }
  if (!ann[`hcptf.io/output.${next.requiredOutput}`]) {
    return { kind: 'not-applied', label: next.label };
  }

  const formData: Record<string, string> = {
    ...next.formData,
    [next.parentField]: `resource:default/${entity.metadata.name}`,
  };
  const targetName = ann['hcptf.io/target'];
  if (targetName) {
    formData.onboardedTarget = `resource:default/${targetName}`;
  }
  return {
    kind: 'link',
    label: next.label,
    href: `/create/templates/default/${next.template}?formData=${encodeURIComponent(
      JSON.stringify(formData),
    )}`,
  };
}

export function VaultNextLayerCard() {
  const { entity } = useEntity();
  const link = nextLayerLink(entity);
  const layer = entity.metadata.annotations?.[LAYER_ANNOTATION];

  return (
    <InfoCard title="Next layer">
      {link.kind === 'link' ? (
        <>
          <Typography variant="body2" gutterBottom>
            Continue the onboarding chain from this {layer} workspace. The new
            workspace is pre-linked to this one as its parent.
          </Typography>
          <Button
            variant="contained"
            color="primary"
            endIcon={<ArrowForwardIcon />}
            component={RouterLink}
            to={link.href}
          >
            {link.label}
          </Button>
        </>
      ) : (
        <Typography variant="body2" color="textSecondary">
          {link.kind === 'final' &&
            'This is a use-case (Layer 3) workspace, the final layer in the chain. There is no next layer to create.'}
          {link.kind === 'not-applied' &&
            `This workspace has not been applied yet, so it has no outputs for the next layer to use. Once its HCP Terraform run succeeds, "${link.label}" becomes available here.`}
          {link.kind === 'none' &&
            'This workspace is not a parent for any onboarding template, so there is no next step to offer.'}
        </Typography>
      )}
    </InfoCard>
  );
}
