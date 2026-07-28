# Contributing

Thanks for helping improve this workspace.

## Development setup

1. Install [Node.js](https://nodejs.org/) 22.13+ and [pnpm](https://pnpm.io/) 11+.
2. From the repository root:

```sh
pnpm install
pnpm check
```

3. Make a focused change with tests.
4. Before opening a PR, run:

```sh
pnpm check
pnpm coverage
```

For algorithm or fee/weight changes also run:

```sh
pnpm mutation
```

## Repository layout

| Path            | Role                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------ |
| `packages/*`    | Published libraries, one directory per npm package (e.g. `packages/utxo-coinselect/`)      |
| `examples/`     | Runnable Node/browser demos                                                                |
| `spec/`         | Language-neutral behavior contracts, one per package                                       |
| `test-vectors/` | Golden cases shared across packages — see [test-vectors/README.md](test-vectors/README.md) |
| `benchmarks/`   | Throughput comparison harness (dev-only competitor deps)                                   |

## Local quality gates

| Command          | Purpose                                              |
| ---------------- | ---------------------------------------------------- |
| `pnpm check`     | Format, lint, typecheck, tests, build (all packages) |
| `pnpm coverage`  | Coverage thresholds, run per package                 |
| `pnpm mutation`  | Mutation testing, run per package                    |
| `pnpm size`      | Published bundle size budget, per package            |
| `pnpm run docs`  | Generate local TypeDoc into `docs/api/` (gitignored) |
| `pnpm benchmark` | Compare selection throughput vs other JS libs        |

Each package versions and releases independently (see below). A change to one package's source must not carry a changeset for a different, unaffected package. Every published package in this workspace stays free of runtime dependencies.

Husky runs Prettier + ESLint on staged files before each commit. Commit messages must follow
[Conventional Commits](https://www.conventionalcommits.org/), for example:

```text
feat(coinselect): prefer changeless Branch-and-Bound solutions
fix(weights): correct P2WSH multisig witness estimate
```

## Pull requests

- Keep the diff focused on one change.
- Add or update tests for behavior changes (unit, property, and/or conformance).
- Keep `pnpm check` and `pnpm coverage` green locally.
- Add a changeset when the change is user-facing (`pnpm changeset`).
- Link related issues when applicable.

## Documentation style

Match existing Markdown spacing (single blank lines around headings, tables, and fences; no double blanks).

## Requirements

- Keep every published package free of runtime dependencies.
- Use `bigint` for every satoshi amount.
- Document public APIs with TSDoc.
- Add unit, property, and/or conformance coverage for changed behavior.
- Keep the coverage gate green (`pnpm coverage`).
- Keep randomized strategies reproducible with an explicit `seed`.
- Update the relevant `spec/*.md` file and `test-vectors/` when normative behavior changes.

## Versioning and releases

This monorepo uses [Changesets](https://github.com/changesets/changesets) and Semantic Versioning.

### Contributor flow

1. Implement the change.
2. Record a changeset describing the user-facing impact:

```sh
pnpm changeset
```

3. Commit the generated `.changeset/*.md` file with your PR.

### Maintainer / CI flow

On every pull request and every push to `main`, CI runs format, lint, types, tests, coverage, build,
size, and mutation checks (Node 22 / 24 for the main test job).

On every push to `main`, the Release workflow either:

- opens/updates a **Version Packages** PR when pending changesets exist, or
- publishes to npm (with provenance) when that version PR is merged **and**
  `NPM_TOKEN` is configured.

Manual publish from a clean tree:

```sh
pnpm version-packages
pnpm release
```

Publishing requires an `NPM_TOKEN` repository secret (Automation token) with
publish rights. The first publish must use a token: npm trusted publishing (OIDC)
can only be attached after `utxo-coinselect` already exists on the registry.
Without `NPM_TOKEN`, Release still opens version PRs but skips `changeset publish`.
