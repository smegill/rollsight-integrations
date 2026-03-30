# RollSight VTT Integrations

This repository contains **VTT (virtual tabletop) integration code only** — the Foundry module and release tooling. It is published from the private RollSight project so that Foundry users can install the module via a public manifest URL.

## For Foundry / Forge users

**Install the module** using this manifest URL in **Setup → Add-on Modules → Install Module**:

```
https://raw.githubusercontent.com/smegill/rollsight-integrations/main/rollsight-integration/module.json
```

See **rollsight-integration/README.md** for setup and **FORGE_INSTALL.md** for detailed install and publish steps. **Release notes** for each module version: **RELEASE_NOTES.md** (in this folder).

## Contents

- **rollsight-integration/** — Foundry VTT module (RollSight Real Dice Reader)
- **release.sh**, **build-release-zip.sh** — Release and zip build
- **FORGE_INSTALL.md**, **PUBLIC_REPO_SETUP.md**, etc. — Docs for install and maintainers

The full RollSight app (desktop app, website, scripts, firmware) lives in the private repository. **Cloud Foundry play** uses HTTPS APIs on the public site (`/api/rollsight-room/*`) documented in the private repo’s `website/README.md` and `docs/ROLLSIGHT_ENVIRONMENT_VARIABLES.md`; the module in this tree consumes those endpoints when cloud room mode is enabled.
