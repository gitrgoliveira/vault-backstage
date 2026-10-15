/**
 * Annotation recording the architecture layer (trust / workload / usecase).
 * Set by the HCP Terraform provider on every ingested vault-workspace Resource
 * and statically on the terraform-module Components in catalog/modules.yaml.
 */
export const LAYER_ANNOTATION = 'hcptf.io/layer';
