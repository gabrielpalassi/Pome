type RegistryPackage = [specifier: string, registry: string, metadata: unknown, integrity: string];

interface Lockfile {
  lockfileVersion: number;
  packages: Record<string, RegistryPackage>;
}

export interface ArchiveSource {
  type: "archive";
  url: string;
  sha512: string;
  dest: string;
}

// Bun 1.4.4's registry cache stores extracted packages as name@version@@@1.
// Keep this layout in sync with the pinned Bun when upgrading it.
export function generateSources(lockfile: Lockfile): ArchiveSource[] {
  if (lockfile.lockfileVersion !== 3) throw new Error("Expected Bun lockfile version 3; review the cache layout.");

  const packages = new Map(Object.values(lockfile.packages).map((entry) => [entry[0], entry]));
  return [...packages.values()]
    .sort(([a], [b]) => a.localeCompare(b, "en"))
    .map(([specifier, registry, , integrity]) => {
      // Fail rather than silently generate incorrect sources for git, local,
      // custom-registry, or prerelease dependencies with different cache paths.
      const match = /^((?:@[^/]+\/)?[^@/]+)@(\d+\.\d+\.\d+)$/.exec(specifier);
      if (!match || registry !== "") throw new Error(`Unsupported Flatpak dependency: ${specifier}`);
      const [, name, version] = match;
      const checksum = /^sha512-([A-Za-z0-9+/]+={0,2})$/.exec(integrity ?? "");
      if (!checksum || Uint8Array.fromBase64(checksum[1]).length !== 64) {
        throw new Error(`Missing SHA-512 integrity for ${specifier}`);
      }
      const basename = name.split("/").at(-1);
      return {
        type: "archive",
        url: `https://registry.npmjs.org/${name}/-/${basename}-${version}.tgz`,
        sha512: Uint8Array.fromBase64(checksum[1]).toHex(),
        dest: `flatpak-bun/cache/${specifier}@@@1`,
      };
    });
}

if (import.meta.main) {
  const root = new URL("../", import.meta.url);
  const lockfile = Bun.JSONC.parse(await Bun.file(new URL("bun.lock", root)).text()) as Lockfile;
  const output = Bun.file(new URL("generated-sources.json", root));
  const contents = `${JSON.stringify(generateSources(lockfile), null, 2)}\n`;
  if (Bun.argv.includes("--check")) {
    if (!(await output.exists()) || (await output.text()) !== contents) {
      console.error("Offline sources are out of date. Run bun run flatpak:sources.");
      process.exit(1);
    }
    console.log("Offline sources match bun.lock.");
  } else {
    await Bun.write(output, contents);
    console.log(`Updated ${output.name}.`);
  }
}
