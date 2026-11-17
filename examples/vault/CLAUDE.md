# Vault (example)

canopy does not require any vault layout. If `~/vault/CLAUDE.md` exists, canopy imports it
into the agent's global CLAUDE.md. Everything else here is just one possible layout:

```
vault/
├── CLAUDE.md            # this file: what the vault is and how to use it
├── notes/               # free-form notes, decisions, meeting logs
├── projects/<name>.md   # per-project context: goals, conventions, links
└── .claude/skills/      # optional: symlinked to ~/.claude/skills by canopy
```

## Rules for the agent
- The vault is synced to git every 5 minutes; do not commit or push it yourself.
- Before starting work on a project, read `~/vault/projects/<name>.md` if it exists.
- Write durable findings (decisions, gotchas) to the vault, not to the repo.
