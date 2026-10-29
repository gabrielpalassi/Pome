<h1><img src="data/icons/hicolor/scalable/apps/io.github.gabrielpalassi.Pome.svg" alt="" width="48" height="48" align="absmiddle"> Pome</h1>

Pome gives Linux desktops a quiet iCloud Drive folder.

<img src="assets/screenshot.png" alt="Pome screenshot" width="640">

Pome keeps iCloud Drive available at `~/iCloud Drive` and reconnects when you log in. On first launch, a desktop notification asks you to sign in through the browser. If the connection needs attention later, notifications let you retry or sign in again.

## Building & Installing

The local Flatpak build currently targets x86-64 Linux and uses Wayland for the sign-in window. You will need:

- Node.js 24 and npm for development commands (the Flatpak bundles its own Node.js)
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
npm run flatpak-install
```

Run the local build:

```sh
flatpak run io.github.gabrielpalassi.Pome
```

## Development

Create a branch from the latest `master`, keep changes focused, and open a pull request when ready. Follow the existing TypeScript style and prefer portals for desktop integration.

Install dependencies and run the checks and tests:

```sh
npm ci
npm run check
npm test
```

`npm run check` runs TypeScript, ESLint, and Prettier checks without changing files. `npm test` builds the app and runs the tests. Use `npm run check:fix` to apply lint and formatting fixes, or `npm run build` to build without running tests.

Changes to packaging, autostart, notifications, sign-in, or host commands also need testing in the installed Flatpak. Build and launch it using the commands above, then exercise the affected desktop flow.

### Host integration

Pome keeps most host interaction in `src/lib/host.ts`, `src/lib/rclone.ts`, and portal-specific helpers. Keep host-side commands limited to work that needs to happen outside the sandbox.

The Flatpak stages its bundled rclone in `~/.var/app/io.github.gabrielpalassi.Pome/data/libexec/`, using a content hash in the filename. Pome verifies and reuses that copy on subsequent launches, and stages a new copy when the bundled binary changes. It runs outside the sandbox to keep `~/iCloud Drive` available to other applications, while continuing to use the host's existing rclone configuration. Native development runs still require rclone on `PATH`.

The rclone version, archive checksum, and license source are pinned in the local Flatpak manifest. Update them together when upgrading rclone.

### Flatpak packaging

`npm run flatpak-install` uses `io.github.gabrielpalassi.Pome.local.yml` to build from the working tree. It needs `generated-sources.json` to populate the npm cache for the offline Flatpak build. Native development with `npm ci` and `npm run build` does not use that file.

This repository keeps the local build manifest and its generated npm sources. Pome has not yet been accepted on Flathub; release packaging will be maintained in the Flathub repository after acceptance. AppStream metadata, desktop files, and icons stay here and are installed from the tagged source release.

If npm dependencies change, use `flatpak-node-generator` to update the offline sources and verify the Flatpak build:

```sh
npm install --package-lock-only --lockfile-version=2
flatpak-node-generator npm package-lock.json -o generated-sources.json
npm run flatpak-install
```

Keep `package-lock.json` at lockfile version 2 so `flatpak-node-generator` can generate complete offline npm sources.

### Releases

Prepare the release in a single pull request:

1. Finish the release changes on a branch. Bump `package.json` and add a matching release entry with the release date in `data/io.github.gabrielpalassi.Pome.metainfo.xml`.
2. Update the lockfile so its package version matches:

   ```sh
   npm install --package-lock-only --lockfile-version=2
   ```

   If dependencies changed, also regenerate `generated-sources.json` as described above. The screenshot URL can keep pointing to an existing tag. If the screenshot changed, point it to the upcoming release tag so the tagged source contains the updated metadata.

3. Run the checks and tests, then build and install the local Flatpak:

   ```sh
   npm ci
   npm run check
   npm test
   npm run flatpak-install
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

No follow-up release pull request is needed in this repository. Once Pome is accepted on Flathub, update the release tag and commit in the Flathub repository's manifest, along with its generated npm sources if dependencies changed. Publishing a source tag alone does not publish a Flathub update.

## Acknowledgments

Pome is powered by [rclone](https://rclone.org/) under the hood. Thanks to the rclone contributors for making its iCloud Drive integration possible.
