# Install canopy on a VPS

At the end you'll have Claude Code running on your server in a container, with your repos cloned,
and (if you want) a Telegram bot to talk to it from your phone. You'll run every command from your
laptop; you won't need to type anything on the server after step 1.

Takes about 30 minutes, most of it waiting for the first build.

## What you need

- **A VPS** with Ubuntu 22.04 or 24.04, at least 2 GB RAM (4 GB is comfortable) and 20 GB of disk.
- **SSH access to it with a key**, as root or a user with sudo.
- **On your laptop**: Node.js 20.12 or newer, git and ssh. Windows, macOS and Linux all work.
- **A GitHub account** with the repos you want the agent to work on.
- **A Claude subscription** (you log in during step 9).

## 1. Install Docker on the server

Connect to the server and run:

```bash
curl -fsSL https://get.docker.com | sh
docker compose version
```

The second command should print a version. If you log in as a user other than root, also run
`sudo usermod -aG docker $USER`, then log out and back in.

That's all you do on the server.

## 2. Check that SSH works without a password

On your laptop:

```bash
ssh -i ~/.ssh/id_ed25519 root@YOUR_SERVER_IP
```

Use your own key path and user. If it asks for a password, the server doesn't know your key yet:
add the contents of `~/.ssh/id_ed25519.pub` to `~/.ssh/authorized_keys` on the server and try again.

## 3. Install the canopy CLI

```bash
git clone https://github.com/Xalk/canopy
cd canopy
npm install
npm run build
npm link
```

Check it: `canopy --version` prints a version number.

## 4. Create a GitHub token

1. Open https://github.com/settings/personal-access-tokens/new.
2. Name it `canopy`, pick an expiration.
3. **Repository access**: *Only select repositories*. Pick the repos for the agent, plus your notes
   repo if you use one.
4. **Permissions**: *Contents* — Read and write; *Pull requests* — Read and write.
5. Generate it and keep the `github_pat_...` value for step 7.

## 5. Create a Telegram bot (optional)

Skip this if you don't want to talk to the agent from your phone.

1. In Telegram, message [@BotFather](https://t.me/BotFather) and send `/newbot`.
2. Pick a name and a username ending in `bot`.
3. Keep the token it sends (`123456789:AA...`) for step 7.

One bot per environment: two servers can't share a bot.

## 6. Describe your environment

Make a new folder for this environment and run the wizard in it:

```bash
mkdir ~/my-canopy
cd ~/my-canopy
canopy init
```

How to answer:

| Question | Answer |
|---|---|
| Profile | `personal` |
| Where will it run? | *your VPS over SSH* |
| SSH key | the key from step 2 |
| VPS host, user, port | your server's IP, `root` (or your user), `22` |
| Knowledge vault | your notes repo, or *No vault* |
| Repo to clone | one `owner/name` at a time; press Enter on an empty line to finish |
| Branch for … | press Enter for the repo's default branch |
| Integrations | Telegram is ticked; untick it if you skipped step 5. Space toggles, Enter confirms |
| Git author, time zone | press Enter to keep the suggested values |

The wizard writes three files: `canopy.yaml` (settings, safe to commit), `.env` (secrets, never commit)
and `.gitignore`.

## 7. Add your secrets

Open `.env` and fill in the empty values: `GH_TOKEN` from step 4, `TELEGRAM_BOT_TOKEN` from step 5.
Each line has a comment saying where the value comes from. `AUTHORIZED_KEYS` is already filled in.

Then check them:

```bash
canopy init --check
```

Every line should start with ✔. A ✘ line says what to fix.

## 8. Start it

```bash
canopy up
```

What happens:

1. It asks whether to upload your `.env` to the server. Answer **yes**. The file is stored in
   `~/canopy-canopy/.env` on the server, readable only by its owner.
2. It uploads the canopy files and builds the image on the server. **The first build takes 5–10
   minutes.** Later runs are much faster.
3. It starts the container, clones your repos and runs a health check.

At the end you'll see a list of ✔ and ✘. **✘ next to "claude logged in" and "telegram paired" is
expected**: that's the next step.

## 9. Log in

```bash
canopy login
```

It walks you through each part:

1. **Claude.** You'll see Claude's first-run screen. Pick a theme, choose to log in with your
   subscription, open the link in your browser, approve, and paste the code back. Answer **Yes** when
   it asks whether to trust the folder. When you see the input box, press `Ctrl+B`, release, then `D`
   to go back to your terminal. Claude keeps running.
2. **Telegram** (if enabled). Send any message to your bot. It replies with a 6-character code.
   Paste the code into the terminal.
3. **Figma** (only if you enabled it). Open the link, click *Allow*. Your browser then fails to open a
   `localhost` page; that's expected. Copy that page's full address and paste it into the terminal.

## 10. Check

```bash
canopy doctor
```

Every line should be ✔. Then send your bot a message. The agent answers.

## Everyday commands

Run them from the folder with `canopy.yaml`.

| Command | What it does |
|---|---|
| `canopy logs --agent` | watch the agent work (leave with `Ctrl+B`, then `D`) |
| `canopy restart` | restart the agent, keep the conversation |
| `canopy fresh` | restart the agent with an empty context |
| `canopy ssh` | open a shell inside the container |
| `canopy add-repo owner/name` | add a project |
| `canopy update --claude` | move to the latest Claude Code |
| `canopy down` | stop it; logins and repos are kept |

## If something goes wrong

- **`Permission denied (publickey)`**: the server doesn't accept your key. Redo step 2.
- **`docker: command not found` or `permission denied ... docker.sock`**: redo step 1, including
  the `usermod` line if you're not root.
- **The build fails with "no space left on device"**: free up disk on the server (`df -h` shows
  what's left).
- **The bot doesn't answer**: run `canopy login status`. Also make sure no other server uses the
  same bot.
- **Anything else**: `canopy logs` shows what the container did on start.

## Good to know

- Only port 22 (SSH) needs to be open on the server. The container's own SSH port is bound to
  `127.0.0.1`.
- Everything the agent has (logins, repos, notes, conversation) lives in the Docker volume
  `canopy_home`. `canopy down` and rebuilds keep it.
- To remove canopy from the server completely: `canopy down`, then on the server
  `docker volume rm canopy_home` and `rm -rf ~/canopy-canopy`.
