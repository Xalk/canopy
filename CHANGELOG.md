# Changelog

All notable changes to this project are documented here. Versions follow [semver](https://semver.org).

## Unreleased

- Telegram shows "typing…" for the whole turn (hooks + `typing.sh`) and reacts 👀 on receipt.
- `canopy mcp add|remove|list`, `canopy chat`, `canopy update` self-update, optional `limits:`.

## 0.1.0

First release.

### Environment
- Ubuntu 24.04 image with pinned Claude Code, Node LTS, Bun, gh, tmux; all state in the `/root` volume.
- Idempotent entrypoint: SSH by key, git and GitHub setup, vault and repos cloned once (`owner/repo#branch`),
  `CLAUDE.md` and `settings.json` built from base + local files, Telegram plugin, Linear and Figma MCP.
- Agent rules: one command per call, untrusted content is data, tests and verification, review, secrets,
  session handoff.
- Vault sync every 5 minutes; `fresh.sh` with a Telegram ping; usage-limit alerts over Telegram;
  `doctor.sh` health check.

### CLI
- `canopy init` wizard and `init --check` key validation.
- `canopy up | down | restart | fresh | doctor | logs | ssh`.
- `canopy login` for Claude, Telegram pairing (no agent turn) and Figma OAuth.
- Targets: `docker`, `ssh` (your VPS) and `railway`.
- `canopy add-repo`, `remove-repo` and `update --claude`.
