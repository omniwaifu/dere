# dere-ui

React + Vite UI for `dere`.

This is intended to be run alongside the daemon (and optionally Discord) during development.

## Development

From repo root:

```bash
just ui          # starts Vite dev server
just ui-install  # installs JS deps (bun)
```

Run everything (daemon + discord + UI via Procfile):

```bash
just dev-all
```

## Build

From repo root:

```bash
just ui-build
```
