import { useState } from 'react';
import { useEntity } from '@backstage/plugin-catalog-react';
import { InfoCard } from '@backstage/core-components';
import {
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableRow,
  Tooltip,
  Typography,
  makeStyles,
} from '@material-ui/core';
import FileCopyIcon from '@material-ui/icons/FileCopy';

const OUTPUT_PREFIX = 'hcptf.io/output.';

const useStyles = makeStyles(theme => ({
  key: {
    fontFamily: 'monospace',
    whiteSpace: 'nowrap',
    verticalAlign: 'top',
    paddingRight: theme.spacing(2),
  },
  value: {
    fontFamily: 'monospace',
    wordBreak: 'break-all',
  },
  empty: {
    color: theme.palette.text.secondary,
  },
}));

export function VaultWorkspaceOutputsCard() {
  const classes = useStyles();
  const { entity } = useEntity();
  const [copied, setCopied] = useState<string | undefined>(undefined);

  const annotations = entity.metadata.annotations ?? {};
  const outputs = Object.entries(annotations)
    .filter(([key]) => key.startsWith(OUTPUT_PREFIX))
    .map(([key, value]) => ({ key: key.slice(OUTPUT_PREFIX.length), value }))
    .sort((a, b) => a.key.localeCompare(b.key));

  const workspaceUrl = annotations['hcptf.io/workspace-url'];
  const runStatus = annotations['hcptf.io/run-status'];

  const copy = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied(undefined), 1200);
    } catch {
      // Clipboard API unavailable (e.g. insecure context); ignore.
    }
  };

  return (
    <InfoCard
      title="Terraform outputs"
      subheader={runStatus ? `Latest run: ${runStatus}` : undefined}
      deepLink={
        workspaceUrl
          ? { title: 'Open workspace in HCP Terraform', link: workspaceUrl }
          : undefined
      }
    >
      {outputs.length === 0 ? (
        <Typography variant="body2" className={classes.empty}>
          No non-sensitive outputs are available yet. The workspace may not have
          been applied, or every output is marked sensitive (sensitive values are
          never exposed here).
        </Typography>
      ) : (
        <Table size="small">
          <TableBody>
            {outputs.map(output => (
              <TableRow key={output.key}>
                <TableCell className={classes.key}>{output.key}</TableCell>
                <TableCell className={classes.value}>{output.value}</TableCell>
                <TableCell padding="none">
                  <Tooltip
                    title={copied === output.key ? 'Copied!' : 'Copy value'}
                  >
                    <IconButton
                      aria-label={`Copy ${output.key}`}
                      size="small"
                      onClick={() => copy(output.key, output.value)}
                    >
                      <FileCopyIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </InfoCard>
  );
}
