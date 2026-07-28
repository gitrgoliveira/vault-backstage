import { Link as RouterLink } from 'react-router-dom';
import { useEntity } from '@backstage/plugin-catalog-react';
import { InfoCard } from '@backstage/core-components';
import { Button, Typography } from '@material-ui/core';
import ArrowForwardIcon from '@material-ui/icons/ArrowForward';

type NextStep = { template: string; label: string };

const NEXT_BY_LAYER: Record<string, NextStep | undefined> = {
  trust: {
    template: 'vault-l2-workload',
    label: 'Create Workload (Layer 2)',
  },
  workload: {
    template: 'vault-l3-usecase',
    label: 'Create Use-case (Layer 3)',
  },
};

/**
 * Shows a button on a vault-workspace Resource that deep-links to the template
 * for the next architecture layer, pre-selecting this workspace as the parent
 * and its tenant/environment target. The chosen values are passed to the
 * scaffolder via the `formData` query param.
 */
export function VaultNextLayerCard() {
  const { entity } = useEntity();
  const ann = entity.metadata.annotations ?? {};
  const layer = ann['hcptf.io/layer'];
  const next = layer ? NEXT_BY_LAYER[layer] : undefined;

  let href: string | undefined;
  if (next) {
    const moduleName = ann['hcptf.io/module-name'] ?? '';
    const targetName = ann['hcptf.io/target'];
    const self = `resource:default/${entity.metadata.name}`;
    const formData: Record<string, string> = {};
    if (targetName) {
      formData.onboardedTarget = `resource:default/${targetName}`;
    }

    if (layer === 'trust') {
      if (moduleName.includes('gitlab-onboarding')) {
        formData.workloadType = 'gitlab';
        formData.parentGitlabTrust = self;
      } else {
        formData.workloadType = 'k8s';
        formData.parentTrustWorkspace = self;
      }
    } else if (layer === 'workload') {
      if (moduleName.includes('gitlab-project-access')) {
        formData.useCaseType = 'kvv2-gitlab';
        formData.parentGitlabWorkload = self;
      } else {
        formData.useCaseType = 'kvv2';
        formData.parentWorkloadWorkspace = self;
      }
    }

    href = `/create/templates/default/${next.template}?formData=${encodeURIComponent(
      JSON.stringify(formData),
    )}`;
  }

  return (
    <InfoCard title="Next layer">
      {next && href ? (
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
            to={href}
          >
            {next.label}
          </Button>
        </>
      ) : (
        <Typography variant="body2" color="textSecondary">
          {layer === 'usecase'
            ? 'This is a use-case (Layer 3) workspace, the final layer in the chain. There is no next layer to create.'
            : 'No next-layer action is available for this workspace.'}
        </Typography>
      )}
    </InfoCard>
  );
}
