# Contributing

Thanks for helping improve utxo-coinselect.

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

| Path             | Role                                                                          |
| ---------------- | ----------------------------------------------------------------------------- |
| `packages/core/` | Published library (`utxo-coinselect`) — selection engine + weights            |
| `examples/`      | Runnable Node/browser demos                                                   |
| `spec/`          | Language-neutral behavior contract                                            |
| `test-vectors/`  | Golden cases for ports — see [test-vectors/README.md](test-vectors/README.md) |
| `benchmarks/`    | Throughput comparison harness (dev-only competitor deps)                      |

## Local quality gates

| Command          | Purpose                                              |
| ---------------- | ---------------------------------------------------- |
| `pnpm check`     | Format, lint, typecheck, tests, build                |
| `pnpm coverage`  | Coverage thresholds for core                         |
| `pnpm mutation`  | Mutation testing for core                            |
| `pnpm size`      | Published bundle size budget                         |
| `pnpm run docs`  | Generate local TypeDoc into `docs/api/` (gitignored) |
| `pnpm benchmark` | Compare selection throughput vs other JS libs        |

Husky runs Prettier + ESLint on staged files before each commit. Commit messages must follow
[Conventional Commits](https://www.conventionalcommits.org/), for example:

```text
feat(core): prefer changeless Branch-and-Bound solutions
fix(weights): correct P2WSH multisig witness estimate
```

## Pull requests

- Keep the diff focused on one change.
- Add or update tests for behavior changes (unit, property, and/or conformance).
- Keep `pnpm check` and `pnpm coverage` green locally.
- Add a changeset when the change is user-facing (`pnpm changeset`).
- Link related issues when applicable.

## Documentation style

Markdown spacing:

- **One** blank line before each heading (except at the top of the file).
- **One** blank line after each heading before body text, lists, or code fences.
- **One** blank line before/after tables and fenced code blocks.
- Do **not** use two or more consecutive blank lines — they only add empty space in previews.

Rendered viewers (GitHub, IDE preview) still add their own margins around lists and headings; that is
normal and is not fixed by inserting extra blank lines in the source.

## Requirements

- Keep `utxo-coinselect` free of runtime dependencies.
- Use `bigint` for every satoshi amount.
- Document public APIs with TSDoc.
- Add unit, property, and/or conformance coverage for changed behavior.
- Keep the coverage gate green (`pnpm coverage`).
- Keep randomized strategies reproducible with an explicit `seed`.
- Update [spec/coin-selection.md](spec/coin-selection.md) and `test-vectors/` when algorithm
  behavior changes.

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

Provenance (`NPM_CONFIG_PROVENANCE`) is disabled while this GitHub repository is
private — npm only supports provenance from public repos. After making the repo
public, you can re-enable it in `.github/workflows/release.yml`.
