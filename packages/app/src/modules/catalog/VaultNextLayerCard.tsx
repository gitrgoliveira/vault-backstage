import { Link as RouterLink } from 'react-router-dom';
import { useEntity } from '@backstage/plugin-catalog-react';
import { InfoCard } from '@backstage/core-components';
import { Button, Typography } from '@material-ui/core';
import ArrowForwardIcon from '@material-ui/icons/ArrowForward';

type NextStep = { template: string; parentField: string; label: string };

// Maps a workspace layer to the template that provisions the next layer, plus
// the EntityPicker field on that template that should be pre-selected with the
// current workspace as the parent.
const NEXT_BY_LAYER: Record<string, NextStep | undefined> = {
  trust: {
    template: 'vault-l2-principal',
    parentField: 'parentTrustWorkspace',
    label: 'Create Principal (Layer 2)',
  },
  principal: {
    template: 'vault-l3-usecase',
    parentField: 'parentPrincipalWorkspace',
    label: 'Create Use-case (Layer 3)',
  },
  usecase: undefined,
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
    // A principal's/trust's parent link is recorded as spec.dependsOn, so the
    // next layer can pre-select the grandparent (e.g. the trust behind a
    // principal) as well as this workspace.
    const parentRef = (entity.spec?.dependsOn as string[] | undefined)?.[0];
    const formData: Record<string, string> = {};
    if (targetName) {
      formData.onboardedTarget = `resource:default/${targetName}`;
    }

    if (layer === 'trust') {
      // From a trust, preselect the matching principal type and this trust as
      // the parent trust field for that type.
      if (moduleName.includes('gitlab-onboarding')) {
        formData.principalType = 'gitlab';
        formData.parentGitlabTrust = self;
      } else {
        formData.principalType = 'k8s';
        formData.parentTrustWorkspace = self;
      }
    } else if (layer === 'principal') {
      // From a principal, preselect the KV use-case matching its type, this
      // principal as the parent, and its trust (dependsOn) as the parent trust.
      if (moduleName.includes('gitlab-project-access')) {
        formData.useCaseType = 'kvv2-gitlab';
        formData.parentGitlabPrincipal = self;
        if (parentRef) {
          formData.parentGitlabTrust = parentRef;
        }
      } else {
        formData.useCaseType = 'kvv2';
        formData.parentPrincipalWorkspace = self;
        if (parentRef) {
          formData.parentTrustWorkspace = parentRef;
        }
      }
    } else {
      formData[next.parentField] = self;
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
