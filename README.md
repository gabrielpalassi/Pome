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

Create a branch from the latest `master`, keep changes focused, and open a pull request when ready. Follow the existing TypeScript style and prefer portals for desktop integration.

Install dependencies and run the checks and tests:

```sh
bun install --frozen-lockfile
bun run verify
bun run test
```

`bun run verify` runs Bun's type checker and formatter plus ESLint without changing files. `bun run test` runs directly against the TypeScript sources; no compilation step is needed. Use `bun run verify:fix` to apply lint and formatting fixes. Run Pome directly with `bun src/pome.ts` when needed. Native runs require rclone and Chrome or Chromium.

`bun check` and `bun fmt` invoke Bun's native tools; `bun run test` invokes Bun's native test runner. Use `bun run typecheck`, `bun run lint`, or `bun run format` for individual checks. The `lint:fix` and `format:fix` scripts apply fixes; `verify` and `verify:fix` combine the corresponding checks.

`bun run bundle` builds `dist/pome.js` for production, targeting Bun with syntax and whitespace minification and an external source map. Dependencies stay external in `node_modules`. Development and tests continue to run TypeScript directly.

Bun-specific settings, formatting options, and ignore patterns live in `bunfig.toml`. `tsconfig.json` configures type checking and editor support. The `typescript` development dependency supports ESLint's parser; `bun check` uses Bun's built-in checker. The Bun version is pinned in `package.json`, CI reads that pin, and the Flatpak manifest pins the matching runtime archive and checksum.

Changes to packaging, autostart, notifications, sign-in, or host commands also need testing in the installed Flatpak. Build and launch it using the commands above, then exercise the affected desktop flow.

### Host integration

Pome keeps most host interaction in `src/lib/host.ts`, `src/lib/rclone.ts`, and portal-specific helpers. Keep host-side commands limited to work that needs to happen outside the sandbox.

The Flatpak stages its bundled rclone in `~/.var/app/io.github.gabrielpalassi.Pome/data/libexec/`, using a content hash in the filename. Pome verifies and reuses that copy on subsequent launches, and stages a new copy when the bundled binary changes. It runs outside the sandbox to keep `~/iCloud Drive` available to other applications, while continuing to use the host's existing rclone configuration. Native development runs still require rclone on `PATH`.

The rclone version, archive checksum, and license source are pinned in the local Flatpak manifest. Update them together when upgrading rclone.

### Flatpak packaging

`bun run flatpak:install` uses `io.github.gabrielpalassi.Pome.local.yml` to build from the working tree. It installs production dependencies offline and runs `bun run bundle` inside the build sandbox. The app ships Bun, the optimized JavaScript bundle and source map, and production dependencies; the TypeScript source tree is removed after bundling. Optional dependencies and lifecycle scripts are disabled. After a successful installation, the script removes the local build directory and Flatpak builder cache.

This repository keeps the local build manifest and its generated dependency sources. Pome has not yet been accepted on Flathub; release packaging will be maintained in the Flathub repository after acceptance. AppStream metadata, desktop files, and icons stay here and are installed from the tagged source release.

After changing dependencies, update the Bun lockfile and regenerate the offline sources:

```sh
bun install
bun run flatpak:sources
bun run flatpak:install
```

`scripts/flatpak-sources.ts` reads `bun.lock` and writes `generated-sources.json`. Flatpak downloads and verifies the declared npm registry archives using their lockfile SHA-512 checksums, then extracts them into Bun's package cache. The build installs from that cache with `--offline --frozen-lockfile`, without network access. CI checks that the generated sources match the lockfile.

The generator declares all locked registry packages, including development dependencies, so the cache can also support offline development checks. The installed app still contains only production dependencies. Git, local, custom-registry, and prerelease dependencies need generator support before they can be packaged; unsupported entries fail explicitly.

When upgrading Bun, update `packageManager` and `engines` in `package.json` and the runtime URL and checksum in the manifest together. The generator targets the pinned Bun's extracted cache layout; verify a clean offline Flatpak build after an upgrade. Native development does not use `generated-sources.json`.

### Releases

Prepare the release in a single pull request:

1. Finish the release changes on a branch. Bump `package.json` and add a matching release entry with the release date in `data/io.github.gabrielpalassi.Pome.metainfo.xml`.
2. If dependencies changed, run `bun install` and `bun run flatpak:sources` to update the lockfile and offline sources. The screenshot URL can keep pointing to an existing tag. If the screenshot changed, point it to the upcoming release tag so the tagged source contains the updated metadata.

3. Run the checks and tests, then build and install the local Flatpak:

   ```sh
   bun install --frozen-lockfile
   bun run verify
   bun run test
   bun run flatpak:install
   ```

   Launch Pome and verify sign-in, mounting, and reconnecting after login before merging.

4. Merge the release pull request into `master`, then pull the merged commit:

   ```sh
   git checkout master
   git pull --ff-only origin master
   ```

5. Create and push an annotated tag from the release commit. Replace `vX.Y.Z` with the version prepared above:

   ```sh
   release_tag=vX.Y.Z
   git tag -a "$release_tag" -m "Release $release_tag"
   git push origin "$release_tag"
   ```

No follow-up release pull request is needed in this repository. Once Pome is accepted on Flathub, update the release tag and commit in the Flathub repository's manifest, along with its generated dependency sources if dependencies changed. Publishing a source tag alone does not publish a Flathub update.

## Acknowledgments

Pome is powered by [rclone](https://rclone.org/) under the hood. Thanks to the rclone contributors for making its iCloud Drive integration possible.
