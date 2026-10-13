import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import { HcpTfClient } from '../HcpTfClient';

export function createRunAction(client: HcpTfClient) {
  return createTemplateAction({
    id: 'hcptf:run:create',
    description: 'Queue a destroy run on an HCP Terraform workspace.',
    schema: {
      input: {
        workspaceId: z => z.string().describe('HCP TF workspace ID (ws-xxx).'),
        isDestroy: z => z.boolean().describe('Set true to queue a destroy run.'),
        message: z => z.string().optional().describe('Human-readable run message.'),
      },
      output: {
        runId: z => z.string(),
        runUrl: z => z.string(),
      },
    },
    async handler(ctx) {
      const { workspaceId, isDestroy, message } = ctx.input;
      const requestedBy =
        (ctx as any).user?.entity?.metadata?.name ??
        (ctx as any).user?.ref ??
        'unknown';
      const runMessage =
        (message as string | undefined) ??
        `${isDestroy ? 'Destroy' : 'Apply'} via Vault IDP by ${requestedBy}`;
      ctx.logger.info(`hcptf:run:create: workspaceId=${workspaceId} isDestroy=${isDestroy}`);
      if (!isDestroy) {
        throw new Error(
          'hcptf:run:create only supports destroy runs. Set isDestroy: true, ' +
            'or use hcptf:nocode:provision to create and apply workspaces.',
        );
      }
      const result = await client.createDestroyRun(workspaceId as string, runMessage);
      ctx.output('runId', result.runId);
      ctx.output('runUrl', result.runUrl);
    },
  });
}
