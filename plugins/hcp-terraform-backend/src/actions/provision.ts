import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import { HcpTfClient, TfVar } from '../HcpTfClient';

function needsHcl(value: string): boolean {
  const t = value.trim();
  return (
    t === 'true' || t === 'false' || t.startsWith('[') || t.startsWith('{') || /^\d+$/.test(t)
  );
}

export function toTfVars(
  vars: Record<string, string>,
  sensitive?: Record<string, boolean>,
): TfVar[] {
  return Object.entries(vars)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => ({
      key,
      value: String(value ?? ''),
      category: 'terraform',
      hcl: needsHcl(String(value ?? '')),
      sensitive: sensitive?.[key] ?? false,
    }));
}

export function createProvisionAction(client: HcpTfClient) {
  return createTemplateAction({
    id: 'hcptf:nocode:provision',
    description:
      'Provision a no-code HCP Terraform workspace inside a tenant project from a private registry module.',
    schema: {
      input: {
        workspaceName: z => z.string().describe('Unique HCP TF workspace name.'),
        moduleName: z => z.string().describe('Registry module name (e.g. terraform-vault-cluster-onboarding).'),
        tenant: z => z.string().optional().describe('Tenant name; used to resolve the {tenant}-Vault-{env} project.'),
        environment: z => z.string().optional().describe('Environment (dev/test/prod) for project resolution.'),
        projectName: z => z.string().optional().describe('Exact HCP TF project name (e.g. an admin project). Overrides tenant/env.'),
        vars: z => z.record(z.string(), z.string()).optional().describe('Terraform variable key/value map.'),
        sensitiveVars: z => z.record(z.string(), z.boolean()).optional().describe('Keys to mark as sensitive.'),
        projectId: z => z.string().optional().describe('Explicit HCP TF project ID (overrides tenant/env resolution).'),
        parentWorkspaceName: z => z.string().optional().describe('Name of the previous-layer workspace to link this one to in the catalog graph (recorded as a parent:<name> tag).'),
        autoApply: z => z.boolean().optional().describe('Auto-apply after plan. Default: true.'),
        waitForRun: z => z.boolean().optional().describe('Wait for the HCP TF run to finish and fail the step if it errors. Default: true.'),
        timeoutMinutes: z => z.number().optional().describe('Max minutes to wait for the run to finish. Default: 20.'),
      },
      output: {
        workspaceId: z => z.string(),
        workspaceUrl: z => z.string(),
        workspaceName: z => z.string(),
        projectId: z => z.string(),
        runId: z => z.string().optional(),
        runStatus: z => z.string().optional(),
        runUrl: z => z.string().optional(),
      },
    },
    async handler(ctx) {
      const {
        workspaceName,
        moduleName,
        tenant,
        environment,
        projectName,
        vars = {},
        sensitiveVars = {},
        projectId,
        parentWorkspaceName,
        autoApply = true,
        waitForRun = true,
        timeoutMinutes = 20,
      } = ctx.input;

      const requestedBy =
        (ctx as any).user?.entity?.metadata?.name ??
        (ctx as any).user?.ref ??
        'unknown';

      // Resolve the tenant project — self-service workspaces MUST land in the
      // <tenant>-Vault-<env> project to inherit Vault dynamic credentials.
      let resolvedProjectId = projectId as string | undefined;
      if (!resolvedProjectId && projectName) {
        resolvedProjectId = await client.resolveProjectByName(projectName as string);
      }
      if (!resolvedProjectId && tenant && environment) {
        resolvedProjectId = await client.resolveProjectId(
          tenant as string,
          environment as string,
        );
      }
      if (!resolvedProjectId) {
        throw new Error(
          'No target project: provide tenant + environment (recommended) or an explicit projectId. ' +
            'Self-service workspaces must run in the tenant project to receive Vault credentials.',
        );
      }

      ctx.logger.info(
        `hcptf:nocode:provision: workspace=${workspaceName} module=${moduleName} project=${resolvedProjectId} requestedBy=${requestedBy}`,
      );

      const noCodModuleId = await client.resolveNoCodModuleId(moduleName as string);
      ctx.logger.info(`Resolved nocode module ID: ${noCodModuleId}`);

      const tfVars = toTfVars(
        vars as Record<string, string>,
        sensitiveVars as Record<string, boolean>,
      );

      const result = await client.createWorkspace({
        workspaceName: workspaceName as string,
        noCodModuleId,
        vars: tfVars,
        projectId: resolvedProjectId,
        requestedBy,
        autoApply: autoApply as boolean,
      });

      ctx.output('workspaceId', result.workspaceId);
      ctx.output('workspaceUrl', result.workspaceUrl);
      ctx.output('workspaceName', result.workspaceName);
      ctx.output('projectId', resolvedProjectId);

      // Record the previous-layer workspace so the catalog graph shows the
      // L1 -> L2 -> L3 chain. Non-fatal: a tagging failure must not fail provisioning.
      if (parentWorkspaceName && parentWorkspaceName !== result.workspaceName) {
        try {
          await client.addWorkspaceTags(result.workspaceId, [
            `parent:${parentWorkspaceName}`,
          ]);
          ctx.logger.info(
            `Linked workspace ${result.workspaceName} -> parent ${parentWorkspaceName}`,
          );
        } catch (err: any) {
          ctx.logger.warn(
            `Could not record parent link (parent:${parentWorkspaceName}): ${err.message}`,
          );
        }
      }

      if (!waitForRun) {
        ctx.logger.info(
          `Workspace ${result.workspaceName} created; not waiting for the run (waitForRun=false).`,
        );
        return;
      }

      ctx.logger.info(
        `Waiting for the HCP Terraform run on ${result.workspaceName} to finish ` +
          `(timeout ${timeoutMinutes}m)...`,
      );

      // Wait for the no-code run to reach a terminal state. waitForRun throws on
      // errored/canceled/discarded/policy_override or timeout, which fails the
      // scaffolder step instead of letting it go green on a failed apply.
      const run = await client.waitForRun(result.workspaceId, {
        autoApply: autoApply as boolean,
        timeoutMs: (timeoutMinutes as number) * 60 * 1000,
        onStatus: (status, runUrl) =>
          ctx.logger.info(`Run status: ${status} (${runUrl})`),
      });

      ctx.output('runId', run.runId);
      ctx.output('runStatus', run.status);
      ctx.output('runUrl', run.runUrl);
      ctx.logger.info(`HCP Terraform run finished: ${run.status} (${run.runUrl})`);
    },
  });
}
