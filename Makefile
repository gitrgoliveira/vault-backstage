SHELL := /bin/zsh
.DEFAULT_GOAL := help

NODE_VERSION := $(shell node -v)
NODE_MAJOR := $(shell node -p "process.versions.node.split('.')[0]")
YARN_VERSION := $(shell yarn -v)

-include .env
ifneq (,$(wildcard .env))
  export
endif

.PHONY: help versions check-node install install-ignore-scripts dev start build lint tsc typecheck test check generate docs-deps docs-site docs-serve screenshots verify-hcptf update-nocode-pins backfill-parent-tags image clean

help: ## Show available targets
	@grep -E '^[a-zA-Z_-]+:.*?## ' Makefile | awk 'BEGIN {FS = ":.*?## "}; {printf "%-14s %s\n", $$1, $$2}'

versions: ## Show active tool versions
	@echo "Node: $(NODE_VERSION)"
	@echo "Yarn: $(YARN_VERSION)"

check-node: ## Verify supported Node major version (22, 24, or 26)
	@if [ "$(NODE_MAJOR)" != "22" ] && [ "$(NODE_MAJOR)" != "24" ] && [ "$(NODE_MAJOR)" != "26" ]; then \
		echo "Unsupported Node version $(NODE_VERSION). Use Node 26 (recommended, isolated-vm@7 requires it), 24, or 22."; \
		exit 1; \
	fi

install: check-node ## Install and build native dependencies
	yarn install

install-ignore-scripts: check-node ## Install without native postinstall scripts (debug fallback)
	yarn install --mode=skip-build

# Sentinel: (re)install dependencies only when the manifests change or
# node_modules is missing. Downstream targets depend on this so a fresh
# checkout builds/tests without a manual `make install` first. Not .PHONY —
# Make compares its mtime against the manifests.
node_modules: package.json yarn.lock
	yarn install
	@touch node_modules

TECHDOCS_VENV := .venv-techdocs

dev: check-node node_modules ## Run Backstage locally
	@if [ -d "$(TECHDOCS_VENV)/bin" ]; then PATH="$(PWD)/$(TECHDOCS_VENV)/bin:$$PATH" yarn start; else yarn start; fi

start: dev ## Alias for dev

build: check-node node_modules ## Build all packages (generates .d.ts, then bundles)
	yarn tsc
	yarn build:all

lint: node_modules ## Run lint checks across repo
	yarn lint:all

tsc: node_modules ## Run full TypeScript check
	yarn tsc:full

typecheck: tsc ## Alias for tsc

test: check-node node_modules ## Run all tests once with coverage (no watch)
	CI=true yarn test:all

check: lint tsc test ## Run lint, typecheck, and tests

generate: ## Generate TechDocs + variable inventory from terraform-docs
	node scripts/generate.mjs

verify-hcptf: ## Read-only HCP TF preflight: validate token + auto-resolve no-code module IDs
	node scripts/verify-hcptf.mjs

update-nocode-pins: ## Pin every Vault no-code module to its latest registry version (needs no-code entitlement)
	node scripts/update-nocode-pins.mjs

backfill-parent-tags: ## Infer & tag parent:<name> on existing workspaces for the graph (dry-run; ARGS=--apply to write)
	node scripts/backfill-parent-tags.mjs $(ARGS)

docs-deps: ## Install local TechDocs build deps into an isolated venv
	python3 -m venv $(TECHDOCS_VENV)
	$(TECHDOCS_VENV)/bin/pip install --quiet --upgrade pip
	$(TECHDOCS_VENV)/bin/pip install --quiet mkdocs mkdocs-techdocs-core mkdocs-material

docs-site: docs-deps ## Build the GitHub Pages documentation site
	$(TECHDOCS_VENV)/bin/mkdocs build --config-file mkdocs.yml

docs-serve: docs-deps ## Serve the docs site locally with live reload
	$(TECHDOCS_VENV)/bin/mkdocs serve --config-file mkdocs.yml

screenshots: ## Capture template form screenshots (requires Backstage running)
	node scripts/capture-screenshots.mjs

image: build ## Build backend Docker image (builds bundle first; requires Docker running)
	yarn build-image

clean: ## Clean build artifacts and caches
	yarn clean
