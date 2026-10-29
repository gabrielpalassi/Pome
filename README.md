<h1><img src="data/icons/hicolor/scalable/apps/io.github.gabrielpalassi.Pome.svg" alt="" width="48" height="48" align="absmiddle"> Pome</h1>

Pome gives Linux desktops a quiet iCloud Drive folder.

<img src="assets/screenshot.png" alt="Pome screenshot" width="640">

Pome keeps iCloud Drive available at `~/iCloud Drive` and reconnects when you log in. On first launch, a desktop notification asks you to sign in through the browser. If the connection needs attention later, notifications let you retry or sign in again.

## Building & Installing

The local Flatpak build currently targets x86-64 Linux and uses Wayland for the sign-in window. You will need:

- Bun 1.4.4 for development commands (the Flatpak bundles the same version)
- `flatpak` and `flatpak-builder`
- host FUSE mount support (`fusermount3` or `fusermount`)
- a working desktop notification portal
- the Freedesktop 26.08 runtime and SDK

Add Flathub as a remote if you do not already have it:

```sh
flatpak remote-add --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo
```

Install the runtime and SDK:

```sh
flatpak install flathub org.freedesktop.Platform//26.08 org.freedesktop.Sdk//26.08
```

Build and install Pome locally:

```sh
bun run flatpak:install
```

Run the local build:

```sh
flatpak run io.github.gabrielpalassi.Pome
```

## Development

Branch from the latest `master`, follow the existing TypeScript style, and open a focused pull request. Prefer portals for desktop integration.

```sh
bun install --frozen-lockfile
bun run verify
bun run test
```

| Command | Purpose |
| --- | --- |
| `bun install --frozen-lockfile` | Install the locked dependencies |
| `bun run verify` | Check types, lint, and formatting without changing files |
| `bun run verify:fix` | Check types and apply lint and formatting fixes |
| `bun run typecheck` | Check TypeScript types |
| `bun run lint` | Check ESLint rules |
| `bun run lint:fix` | Apply ESLint fixes |
| `bun run format` | Check formatting |
| `bun run format:fix` | Apply formatting fixes |
| `bun run test` | Run tests directly against TypeScript |
| `bun run bundle` | Build the production bundle in `dist/` |
| `bun run flatpak:sources` | Regenerate offline dependency sources from `bun.lock` |
| `bun run flatpak:install` | Build and install the local Flatpak, preserving the build cache |
| `bun run flatpak:clean` | Remove the Flatpak build directory and cache |
| `bun src/pome.ts` | Run locally; requires rclone and Chrome or Chromium |

- **Configuration:** `bunfig.toml` holds Bun and formatting settings; `tsconfig.json` configures types and editor support.
- **Type checking:** `bun check` uses Bun's built-in checker. The `typescript` dependency supports ESLint's parser.
- **Production bundle:** Bun-targeted JavaScript with syntax and whitespace minification, a source map, and external dependencies in `node_modules`.

Test packaging, autostart, notifications, sign-in, and host-command changes in the installed Flatpak too.

### Host integration

Host commands belong in `src/lib/host.ts`, `src/lib/rclone.ts`, or portal helpers. Keep them limited to work that requires leaving the sandbox.

- rclone runs on the host so other applications can access `~/iCloud Drive`. It uses the host's existing rclone configuration.
- The Flatpak stages a verified, reusable copy in `~/.var/app/io.github.gabrielpalassi.Pome/data/libexec/`. Filenames include a content hash; bundled updates get a new copy.
- Native runs require rclone on `PATH`. When upgrading the bundled version, update its version, archive checksum, and license source together in the manifest.

### Flatpak packaging

`bun run flatpak:install` builds the working tree using `io.github.gabrielpalassi.Pome.local.yml`:

1. Install production dependencies offline, with optional dependencies and lifecycle scripts disabled.
2. Build the optimized bundle and remove the TypeScript source tree.
3. Package Bun, the bundle and source map, and production dependencies.
4. Install the app, keeping build output and cached downloads for inspection and faster rebuilds.

Use `bun run flatpak:clean` to reclaim disk space or prepare a completely fresh build. Normal installs use `--force-clean` to reset the output directory while preserving the builder cache.

After changing dependencies:

```sh
bun install
bun run flatpak:sources
bun run flatpak:install
```

**Offline sources:** `scripts/flatpak-sources.ts` converts `bun.lock` into `generated-sources.json`. Flatpak verifies the archives against their SHA-512 checksums and extracts them into Bun's cache. Installation uses `--offline --frozen-lockfile`; CI checks that sources match the lockfile.

- The cache includes all locked packages; the installed app contains only production dependencies.
- Git, local, custom-registry, and prerelease dependencies need generator support. Unsupported entries fail explicitly.
- Native development does not use `generated-sources.json`.

**Bun upgrades:** Update `packageManager` and `engines` in `package.json`, plus the manifest's runtime URL and checksum. CI reads the package pin. Verify a clean offline Flatpak build: the generator depends on the pinned Bun's cache layout.

Pome is not yet accepted on Flathub. This repository keeps the local manifest, generated sources, AppStream metadata, desktop files, and icons. After acceptance, release packaging will live in the Flathub repository; metadata and assets will remain here.

### Releases

Prepare each release in a single pull request:

1. Bump `package.json` and add a dated release entry in `data/io.github.gabrielpalassi.Pome.metainfo.xml`.
2. If dependencies changed, run `bun install` and `bun run flatpak:sources`. If the screenshot changed, point its metadata URL to the upcoming tag; otherwise keep the existing URL.
3. Validate the release:

   ```sh
   bun install --frozen-lockfile
   bun run verify
   bun run test
   bun run flatpak:install
   ```

   Test sign-in, mounting, and reconnection after login before merging.

4. Merge the pull request and pull the release commit:

   ```sh
   git checkout master
   git pull --ff-only origin master
   ```

5. Create and push an annotated tag, replacing `vX.Y.Z`:

   ```sh
   release_tag=vX.Y.Z
   git tag -a "$release_tag" -m "Release $release_tag"
   git push origin "$release_tag"
   ```

After Flathub acceptance, update its manifest's release tag and commit, plus generated sources if dependencies changed. A source tag alone does not publish a Flathub update. No follow-up release pull request is needed here.

## Acknowledgments

Pome is powered by [rclone](https://rclone.org/) under the hood. Thanks to the rclone contributors for making its iCloud Drive integration possible.
