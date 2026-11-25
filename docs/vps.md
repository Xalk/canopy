# Install canopy on a VPS

At the end you'll have Claude Code running on your server in a container, with your repos cloned,
and (if you want) a Telegram bot to talk to it from your phone.

You do everything over SSH on the server itself: the canopy CLI lives there next to the container.
Takes about 20 minutes, most of it waiting for the first build.

## What you need

- **A VPS** with Ubuntu 22.04 or 24.04, at least 2 GB RAM (4 GB is comfortable) and 20 GB of disk.
  x86 and ARM (e.g. Oracle Ampere) both work.
- **SSH access to it with a key.** Any SSH client works (Terminal, MobaXterm, PuTTY).
- **A GitHub account** with the repos you want the agent to work on.
- **A Claude subscription** (you log in during step 9).

Only port 22 (SSH) needs to be open. Don't open anything else for canopy.

## 1. Install Docker

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
exit
```

Connect again (the group change needs a fresh login) and check:

```bash
docker ps
```

It should print an empty table, without `sudo`.

## 2. Install Node.js

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/master/install.sh | bash
source ~/.bashrc
nvm install --lts
node -v
```

## 3. Install the canopy CLI

```bash
git clone https://github.com/Xalk/canopy.git ~/canopy
cd ~/canopy
npm ci && npm run build && npm link
canopy --version
```

`canopy --version` prints a version number. Run the install from `~/canopy`, the folder with
`package.json`.

## 4. Create a GitHub token

1. Open https://github.com/settings/personal-access-tokens/new.
2. Name it `canopy`, pick an expiration.
3. **Repository access**: *Only select repositories*. Pick the repos for the agent, plus your notes
   repo if you use one. Private repos are fine.
4. **Permissions**: *Contents* — Read and write; *Pull requests* — Read and write.
5. Generate it and keep the `github_pat_...` value for step 7.

## 5. Create a Telegram bot (optional)

Skip this if you don't want to talk to the agent from your phone.

1. In Telegram, message [@BotFather](https://t.me/BotFather) and send `/newbot`.
2. Pick a name and a username ending in `bot`.
3. Keep the token it sends (`123456789:AA...`) for step 7.

One bot per environment. If another server already uses this bot, stop it before step 8.

## 6. Describe your environment

Your settings live in their own folder, apart from the canopy code, so updating canopy never
touches them:

```bash
mkdir ~/canopy-env && cd ~/canopy-env
canopy init
```

How to answer:

| Question | Answer |
|---|---|
| Profile | `personal` |
| Where will it run? | *docker on this machine* |
| Use the key you log in here with? | **Yes**. canopy lets the same SSH key into the container |
| Knowledge vault | *I have one* and `owner/name` of your notes repo, or *No vault* |
| Repo to clone | one `owner/name` at a time; press Enter on an empty line to finish |
| Branch for … | press Enter for the repo's default branch |
| Talk to the agent from Telegram? | Yes if you did step 5 |
| Git author, time zone | press Enter to keep the suggested values |

Two messages you may see on the way, both fine:

- **"Can't look into owner/repo from this machine"**: the repo is private and git on the server
  has no GitHub login. The container clones it later with your token.
- **"No SSH key picked"**: only if you answered No about the key. Put your public key into
  `AUTHORIZED_KEYS` in `.env` by hand (`cat ~/.ssh/authorized_keys` shows it).

The wizard writes `canopy.yaml` (settings, no secrets), `.env` (secrets) and `.gitignore`.

## 7. Add your secrets

```bash
nano .env
```

Fill in `GH_TOKEN` from step 4 and `TELEGRAM_BOT_TOKEN` from step 5. Each line has a comment saying
where the value comes from. Save with `Ctrl+O`, `Enter`, `Ctrl+X`.

Then check them:

```bash
canopy init --check
```

Every line should start with ✔. A ✘ line says what to fix.

## 8. Start it

```bash
canopy up
```

It builds the image, starts the container, clones your repos and runs a health check. The first
build takes a few minutes; later runs take seconds.

At the end you'll see ✔ and ✘ lines. **✘ next to "claude logged in" and "telegram paired" is
expected**: that's the next step.

## 9. Log in

```bash
canopy login
```

1. **Claude.** You'll see Claude's first-run screen. Pick a theme, choose to log in with your
   subscription, open the link in a browser (on any device), approve, and paste the code back.
   Answer **Yes** when it asks whether to trust the folder. When the input box appears, press
   `Ctrl+B`, release, then `D`. Claude keeps running.
2. **Telegram** (if enabled). Send any message to your bot. It replies with a 6-character code.
   Paste the code.

## 10. Check

```bash
canopy doctor
```

Every line should be ✔ or – (skipped). Then send your bot a message; the agent answers.

## Add Linear or Figma (optional)

```bash
canopy mcp add linear    # asks for your Linear API key, then applies
canopy mcp add figma     # applies, then logs you in to Figma
```

For Figma: open the link it prints and click *Allow*. Your browser then fails to open a
`localhost` page; that's expected. Copy that page's full address and paste it into the terminal.

`canopy mcp list` shows what's on; `canopy mcp remove figma` turns it off.

## Everyday commands

Run them from `~/canopy-env`.

| Command | What it does |
|---|---|
| `canopy chat` | open the agent's Claude session and type in it (leave: `Ctrl+B`, then `D`) |
| `canopy logs --agent` | watch the agent without being able to type |
| `canopy restart` | restart the agent, keep the conversation |
| `canopy fresh` | restart the agent with an empty context |
| `canopy ssh` | open a shell inside the container |
| `canopy add-repo owner/name` | add a project |
| `canopy update` | update canopy and rebuild the container |
| `canopy update --claude` | move to the latest Claude Code |
| `canopy down` | stop it; logins and repos are kept |

To update canopy itself, run `canopy update` in `~/canopy-env`: it shows the new commits, then pulls,
rebuilds the CLI and the container. Logins and the conversation are kept.

## If something goes wrong

- **`permission denied ... docker.sock`**: you skipped the fresh login after step 1. Reconnect.
- **`canopy: command not found`**: run step 3 again from `~/canopy`.
- **The build fails with "no space left on device"**: free up disk (`df -h` shows what's left).
- **The bot doesn't answer**: run `canopy login status`, and make sure no other server uses the bot.
- **Anything else**: `canopy logs` shows what the container did on start.

## Good to know

- Everything the agent has (logins, repos, notes, conversation) lives in the Docker volume
  `canopy_home`. `canopy down`, `canopy up` and image rebuilds keep it.
- To remove canopy completely: `canopy down`, then `docker volume rm canopy_home`, then delete
  `~/canopy` and `~/canopy-env`.

## Driving a VPS from your laptop instead

You can also keep the CLI on your laptop (Windows, macOS, Linux) and let it manage the server over
SSH. Do steps 1 and 3–5 as above (step 3 on the laptop), then in `canopy init` choose *a VPS,
driven from here over SSH* and enter the server's address, user and port. `canopy up` uploads
everything to `~/canopy-<name>` on the server (it asks before uploading `.env`), and all other
commands run over the same SSH connection.
