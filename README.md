# Pome

Pome gives Linux desktops a quiet iCloud Drive folder.

> ⚠️ Pome is currently beta software. It is ready for testing, but you may still run into rough edges, missing features, or changes between releases.

It runs in the background, mounts iCloud Drive through `rclone`, and keeps the folder available at `~/iCloud Drive`. When the connection needs attention, Pome uses desktop notifications instead of a permanent window: you can retry the mount, sign in again, or let it keep waiting in the background.

## Running Pome

Install `rclone` before running Pome. Pome connects to iCloud Drive through the `rclone` command on your system, so it needs to be installed on the host rather than inside the Flatpak sandbox. Pome requires `rclone` 1.69.0 or newer, the first release with iCloud Drive support; check your installed version with:

```sh
rclone version
```

The safest way to get a recent enough version is the official `rclone` installer:

```sh
sudo -v
curl https://rclone.org/install.sh | sudo bash
```

If your distribution already ships `rclone` 1.69.0 or newer, you can install it from your package manager instead:

```sh
# Fedora
sudo dnf install rclone

# Ubuntu/Debian
sudo apt install rclone

# Arch Linux
sudo pacman -S rclone
```

Then run Pome from your app launcher, or start it manually:

```sh
flatpak run io.github.gabrielpalassi.Pome
```

On first launch, Pome prepares an iCloud Drive remote for `rclone` and asks you to sign in. Click `Sign In` in the notification, complete the browser sign-in, and Pome will connect your iCloud Drive folder.

After the first launch, Pome adds itself to your desktop autostart entries so it can reconnect iCloud Drive when you log in.

If iCloud needs attention later, Pome will show a notification with actions:

- `Try Again` retries the mount.
- `Sign In` refreshes your iCloud session.

## Building Locally

Local builds use Flatpak Builder. You will need:

- `flatpak`
- `flatpak-builder`
- `rclone`
- a working desktop notification portal
- the Freedesktop runtime and SDK used by the manifest

Add Flathub if you do not already have it:

```sh
flatpak remote-add --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo
```

Install the runtime and SDK:

```sh
flatpak install flathub org.freedesktop.Platform//25.08 org.freedesktop.Sdk//25.08
```

Build and install Pome locally:

```sh
flatpak-builder --user --install --force-clean build-dir io.github.gabrielpalassi.Pome.yml
```

Run the local build:

```sh
flatpak run io.github.gabrielpalassi.Pome
```

## Development

Install Node dependencies:

```sh
npm ci
```

Run the project checks. This type-checks the code, applies ESLint fixes, and formats files with Prettier:

```sh
npm run check
```

Build the JavaScript output:

```sh
npm run build
```

Useful `rclone` checks while developing:

```sh
rclone listremotes
rclone config show iclouddrive
```

## Contributing

Keep changes focused and follow the existing TypeScript style. Before opening a pull request, run:

```sh
npm run check
npm run build
```

If your change touches Flatpak packaging or desktop integration, also build and run the Flatpak locally:

```sh
flatpak-builder --user --install --force-clean build-dir io.github.gabrielpalassi.Pome.yml
flatpak run io.github.gabrielpalassi.Pome
```

Pome intentionally keeps most host interaction in `src/lib/host.ts`, `src/lib/rclone.ts`, and portal-specific helpers. Prefer portals for desktop integration when a suitable portal exists, and keep host-side commands limited to work that must happen outside the sandbox.
