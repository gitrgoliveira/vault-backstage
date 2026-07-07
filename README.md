# [Backstage](https://backstage.io)

This is your newly scaffolded Backstage App for the internal Vault IDP.

The **Create** page surfaces the self-service Vault onboarding templates — trust (Layer 1), principal (Layer 2), and use-case (Layer 3), plus admin tenant onboarding:

![Backstage Create page listing the Vault onboarding templates](screenshots/create-page.png)

Use the Makefile as the single entry point.

Toolchain policy (verified):

- Node: `24` recommended (`22` also supported by Backstage here). This repo includes `.nvmrc` and `.node-version` pinned to `24`.
- Yarn: `4.13.0` (from scaffolded repo config).
- Backstage CLI: `0.36.3` (current latest on npm at implementation time).

Check active versions:

```sh
make versions
```

To get started:

```sh
make install
make dev
```

Useful commands:

```sh
make help
make check
make build
```

Configuration:

- Copy `.env.example` to `.env` and set `HCP_TF_TOKEN`.
- Configure `hcpTerraform` settings in `app-config.yaml` and optional overrides via environment variables.
