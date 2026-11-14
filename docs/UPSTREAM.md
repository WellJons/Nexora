# Existing projects and integration candidates

We use the public Modrinth API rather than reimplementing a mod catalogue. No external project source code has been copied in 0.3.

| Project | License reported by GitHub | Role |
|---|---|---|
| [PrismLauncher](https://github.com/PrismLauncher/PrismLauncher) | GPL-3.0 | Existing Minecraft launcher; evaluate profile import/launch via documented interfaces. |
| [Thunderstore](https://github.com/thunderstore-io/Thunderstore) | AGPL-3.0 | Evaluate public package API; no source copying. |
| [NexusMods.App](https://github.com/Nexus-Mods/NexusMods.App) | GPL-3.0 | Reference only; repo is archived. Evaluate official Nexus Mods API separately. |
| [Modrinth](https://github.com/modrinth/code) | Mixed/NOASSERTION | Public API integration; review component licenses if copying source. |

Before incorporating upstream code, check its exact license and compatibility, preserve required notices and meet source disclosure obligations where applicable. API integrations must respect provider access and terms.

## Integrated dependencies (0.4)

- `systeminformation` (MIT): runtime hardware metrics. Original license distributed in its installed package.
- `@electron/packager` (BSD-2-Clause): build-time Windows packaging; original license in its npm package.
- `electron` (MIT and bundled third-party notices): desktop runtime. Packaged distribution retains Electron license files.

Dependencies are used through their public APIs, not copied into application source.

The 0.5 external trainer workflow is interoperable with separately installed Cheat Engine and Apprentice. No trainer source or binary is included; their own license and distribution remain separate.

In 0.7 the external-launch approach was removed. The integrated Nexora memory module is original C# code using Windows APIs. The .NET runtime is bundled by SDK publishing; its third-party notices are retained with the package.
