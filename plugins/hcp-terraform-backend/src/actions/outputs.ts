import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import { HcpTfClient } from '../HcpTfClient';

export function createOutputsReadAction(client: HcpTfClient) {
  return createTemplateAction({
    id: 'hcptf:outputs:read',
    description: 'Read current state-version outputs from an HCP Terraform workspace.',
    schema: {
      input: {
        workspaceId: z => z.string().describe('HCP TF workspace ID (ws-xxx).'),
      },
      output: {
        outputs: z => z.record(z.string(), z.unknown()).describe('Output key/value map. Sensitive values are masked.'),
      },
    },
    async handler(ctx) {
      const { workspaceId } = ctx.input;
      ctx.logger.info(`hcptf:outputs:read: workspaceId=${workspaceId}`);
      const raw = await client.readOutputs(workspaceId as string);
      const outputs: Record<string, unknown> = {};
      for (const o of raw) {
        outputs[o.key] = o.sensitive ? '(sensitive)' : o.value;
      }
      ctx.logger.info(`Read ${raw.length} outputs from ${workspaceId}`);
      ctx.output('outputs', outputs);
    },
  });
}
