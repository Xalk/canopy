<p align="center">
  <img src="assets/logo.png" alt="canopy" width="560">
</p>

<p align="center">
  One command to bring up a ready-to-work Claude Code environment on any server.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Claude_Code-2.1.326-D97757" alt="Claude Code">
  <img src="https://img.shields.io/badge/Ubuntu-24.04-E95420?logo=ubuntu&logoColor=white" alt="Ubuntu 24.04">
  <img src="https://img.shields.io/badge/Docker-compose-2496ED?logo=docker&logoColor=white" alt="Docker">
  <img src="https://img.shields.io/badge/deploy-Railway-0B0D0E?logo=railway&logoColor=white" alt="Railway">
</p>

---

canopy packages everything around [Claude Code](https://claude.com/claude-code) into one reproducible container:
your repos, a knowledge vault, agent rules, permissions, a Telegram channel and MCP servers.
Rebuild it anywhere and you get the same environment back.

canopy is **not** an agent, an orchestrator or a framework. It runs stock Claude Code and does not dictate
how you structure your project docs or your vault.

## Features

- 📦 **Pinned toolchain**: Claude Code, Node LTS, Bun, gh, git, tmux, ripgrep, jq on Ubuntu 24.04
- 🔁 **Idempotent start**: repos and vault are cloned once; restarts and rebuilds keep all state in the `/root` volume
- 🗂️ **Vault sync**: `~/vault` is committed, rebased and pushed every 5 minutes
- 💬 **Telegram channel**: talk to the agent from your phone; remote control is on as well
- 🔄 **Fresh sessions on request**: ask for a new session and get a Telegram ping when it's ready
- 💾 **Small-volume friendly**: npm / yarn / bun caches stay off the volume; `doctor.sh` warns at 85% disk
- 🛡️ **Safe by default**: `auto` mode with explicit allow / ask / deny rules, SSH by key only
- 🩺 **`doctor.sh`**: one ✔/✘ line per component, with a hint for every ✘

## Quick start

```bash
git clone https://github.com/<you>/canopy && cd canopy
cp .env.example .env      # at minimum: AUTHORIZED_KEYS and GH_TOKEN
docker compose up -d
docker compose exec canopy bash -lc doctor.sh
```

Then do the [one-time manual steps](#manual-steps). They persist across restarts.

## Configuration

Every variable is documented in [`.env.example`](.env.example).

| Variable | Required | Purpose |
|---|:---:|---|
| `AUTHORIZED_KEYS` | ✔ | SSH public key(s), `;`-separated |
| `GH_TOKEN` | ✔ | GitHub token for clone / push / PRs |
| `REPOS` | | `owner/name,...` cloned into `~/projects/` |
| `VAULT_REPO` | | knowledge vault cloned into `~/vault` and synced |
| `WORKDIR` | | agent working dir; defaults to the first repo |
| `TELEGRAM_BOT_TOKEN` | | enables the Telegram channel |
| `LINEAR_API_KEY` | | adds the Linear MCP server |
| `GIT_NAME` / `GIT_EMAIL` | | defaults to the token's GitHub user |

Any variable can be read from a file instead: `GH_TOKEN_FILE=/run/secrets/gh_token` (Docker secrets).

**Base and local.** Defaults live in [`config/`](config/). Your changes go into `/root/canopy.local/`
(`CLAUDE.local.md`, `settings.local.json`) and are merged on every start; local permission rules are added to
the base ones, not replacing them. See [`examples/`](examples/).
Skills in the vault's `.claude/skills/` are linked into `~/.claude/skills` one by one.

`PROFILE` (`personal` | `project`) only describes intent in V1; both behave the same.

## Manual steps

Connect with `ssh -p 2222 root@localhost`, then:

1. **Log in to Claude**: `tmux attach -t claude`, follow the login prompt, detach with `Ctrl+B` `D`.
2. **Pair Telegram**: DM your bot, it replies with a code. In the Claude session:
   ```
   /telegram:access pair <code>
   /telegram:access policy allowlist
   ```

<details>
<summary><b>OAuth for remote MCP servers (Figma and others)</b></summary>

<br>

OAuth redirects to `http://localhost:<port>/callback`, which is the server, not your laptop.

1. `claude mcp add -s user -t http figma https://mcp.figma.com/mcp`
2. In the Claude session: `/mcp` → the server → *Authenticate*. Claude prints a URL and waits.
3. Open the URL locally and approve. The redirect to `localhost:<port>/callback?...` fails; copy that full URL.
4. In a second SSH session: `curl 'http://localhost:<port>/callback?code=...&state=...'`

</details>

## Deploy on Railway

<details>
<summary><b>Step by step</b></summary>

<br>

1. New project → *Deploy from GitHub repo* → your fork of canopy.
2. Add a **Volume** mounted at `/root`. Without it, logins and clones are lost on every redeploy.
3. **Variables**: paste your `.env` into the raw editor.
4. **Settings → Networking → TCP Proxy** on port `22`, then `ssh -p <port> root@<host>`.
5. Do the [manual steps](#manual-steps).

The SSH host key is stored in the volume, so redeploys don't trigger "host key changed" warnings.

</details>

## Security

- **No `--dangerously-skip-permissions`.** It disables every check, `deny` included, so one prompt injection
  from a web page, file or ticket could do anything the container can. canopy uses `auto` mode with
  [explicit rules](config/settings.base.json): routine commands run, force-pushes ask, destructive commands,
  `sudo` and reading `~/.ssh` or `.env` files are denied.
- **Minimal tokens.** Fine-grained `GH_TOKEN` scoped to your repos and vault (Contents + Pull requests),
  one Telegram bot per environment.
- **Know where secrets live.** `env_file` keeps them out of compose files and git, but `docker inspect` still
  shows them; use `*_FILE` with Docker secrets if that matters. Inside the container the agent's shell can read
  them: `deny` rules prevent accidents, they are not a sandbox.

## Roadmap

- [x] **V1**: reproducible Claude Code environment
- [ ] **V2**: other agents
- [ ] **V3**: more integrations (Slack)
- [ ] **V4**: several environments managed together
