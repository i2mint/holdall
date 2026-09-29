# holdall: map for agents working on this repo

- `src/`: the headless core, one module per concern (`envelope`, `link`, `merge`, `collection`, `files`, `durability`, `autosave`); `zodal.ts` is the `holdall/zodal` facade; `cli.ts` is the `holdall` bin.
- `tests/`: vitest; `smoke.test.ts` is the one-command test and needs `pnpm build` first.
- `skills/`: the SHIPPED skills (router `holdall` + nested `holdall-*`). They are the product's main surface: when an API changes, update the skills that name it in the same PR.
- `agents/`: shipped subagent definitions.
- `docs/design.md`: seams and surfaces. `docs/research/`: cited research behind every default.
- Release: a merge to `main` publishes to npm when `package.json` has a new version (see `.github/workflows/ci.yml`).
- This repo is PUBLIC: no local paths, hostnames or names of private apps in anything committed.
