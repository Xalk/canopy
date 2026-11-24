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
- 🔄 **Fresh sessions on request**: ask for a new session and get a Telegram ping when it's ready;
  the agent leaves a handoff that the new session loads automatically
- 🔔 **Usage-limit alerts**: Telegram warning at 80% of the 5-hour / weekly limit and a notice when it runs out,
  sent by the shell, so they arrive even when the agent can't answer
- 💾 **Small-volume friendly**: npm / yarn / bun caches stay off the volume; `doctor.sh` warns at 85% disk
- 🛡️ **Safe by default**: `auto` mode with explicit allow / ask / deny rules, SSH by key only
- 🩺 **`doctor.sh`**: one ✔/✘ line per component, with a hint for every ✘

## Quick start

The `canopy` CLI runs on your laptop (Windows, macOS, Linux; Node 20.12+) and drives the container for you.

```bash
git clone https://github.com/<you>/canopy && cd canopy
npm install && npm run build && npm link     # puts `canopy` on your PATH

mkdir ~/my-env && cd ~/my-env
canopy init            # a few questions -> canopy.yaml, .env (with where-to-get comments), .gitignore
                       # fill in the keys it lists in .env
canopy init --check    # validates the keys against GitHub, Linear and Telegram
canopy up              # builds and starts the container, then runs doctor
canopy login           # Claude login, Telegram pairing, Figma: no typing inside the container
```

Then message your bot in Telegram. Logins and clones live in the `/root` volume and survive restarts.

<details>
<summary><b>Without the CLI</b></summary>

<br>

```bash
cp .env.example .env      # at minimum: AUTHORIZED_KEYS and GH_TOKEN
docker compose up -d
docker compose exec canopy bash -lc doctor.sh
```

Then do the [manual steps](#manual-steps).

</details>

## CLI

Put `canopy.yaml` (no secrets) next to `.env` (secrets only) and run commands from that folder.

```yaml
# canopy.yaml
name: canopy            # compose project, image and volume name
target: docker          # docker | ssh (your VPS) | railway
vault: you/vault
repos:
  - you/app
  - { repo: you/api, branch: develop }
mcp: [linear, figma]
```

| Command | What it does |
|---|---|
| `canopy init` | wizard: target, SSH key, vault (can create one), repos, integrations, git author |
| `canopy init --check` | validate `.env` keys against GitHub, Linear and Telegram; values are never printed |
| `canopy login [service]` | log in to Claude, pair Telegram, authorize Figma; `status` shows what is connected |
| `canopy up` | build and start the container, wait for setup, run doctor |
| `canopy down` | stop the container; the `/root` volume is kept |
| `canopy restart` | restart the agent and keep the conversation |
| `canopy fresh` | restart the agent with a clean context |
| `canopy doctor` | ✔/✘ for every part; exit code 1 if anything fails |
| `canopy logs [--agent]` | follow container logs, or watch the agent session read-only |
| `canopy ssh` | open a shell inside the container |
| `canopy add-repo <repo> [--branch]` | add a project and clone it; no image rebuild |
| `canopy remove-repo <repo>` | remove a project; deleting its files in the container is optional |
| `canopy update --claude [version]` | move Claude Code to a version (default: latest), rebuild, run doctor |

### Targets

| `target` | Where it runs | How |
|---|---|---|
| `docker` | this machine | `docker compose` with a compose file generated in `.canopy/` |
| `ssh` | your VPS | uploads the image sources over SSH to `~/canopy-<name>` and runs `docker compose` there; `.env` is uploaded only after you confirm |
| `railway` | Railway | `railway link` once, then variables (confirmed, sent via stdin), the `/root` volume and `railway up` |

```yaml
target: ssh
vps: { host: 1.2.3.4, user: root, port: 22, key: ~/.ssh/id_ed25519 }   # the docker host
```

```yaml
target: railway
ssh: { host: x.proxy.rlwy.net, port: 30029, key: ~/.ssh/id_ed25519 }   # the TCP proxy
```

Railway CLI can't create a TCP proxy: add it once in the dashboard (service -> Settings -> Networking ->
TCP Proxy -> port 22) and put its host and port under `ssh:`.

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

### Your workflow lives in the vault

canopy ships only general agent rules (tests, verification, review, handoff). Your process — spec stages,
ticket flow, review checklists, triage — belongs in your own skills: put them in `~/vault/.claude/skills/`
and canopy links them into every session. Adapt the tool to your process, not the other way round.

## Manual steps

**With the CLI**, one command walks you through all of them and skips what is already done:

```bash
canopy login            # or: canopy login claude | telegram | figma | status
```

- **Claude**: opens the agent session; log in, trust the folder, detach with `Ctrl+B` `D`.
- **Telegram**: DM your bot, paste the 6-character code it replies with. canopy approves it and switches the bot
  to allowlist itself (no agent turn, no tokens).
- **Figma** (add `figma` to `mcp:`): open the printed link, click Allow, then paste the `localhost` address the
  browser fails to load. That address carries the one-time code back to the server.

<details>
<summary><b>Without the CLI</b></summary>

<br>

Connect with `ssh -p 2222 root@localhost`, then:

1. **Claude**: `tmux attach -t claude`, follow the login prompt, detach with `Ctrl+B` `D`.
2. **Telegram**: DM your bot, it replies with a code; run `telegram-pair.sh <code>`.
3. **Figma or another OAuth MCP server**: `claude mcp add -s user -t http figma https://mcp.figma.com/mcp`,
   then `claude mcp login figma --no-browser` and follow it.

</details>

## Deploy on Railway

With the CLI: `target: railway` in `canopy.yaml`, then `canopy up` (see [Targets](#targets)).

<details>
<summary><b>Without the CLI</b></summary>

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
