# Working conventions for this repo

## Stamping src/version.js after every commit

Every commit that changes code must be followed by a separate, small commit
titled `Stamp version.js with commit <short-hash>` that updates
`src/version.js`'s `GIT_COMMIT` (to the short hash of the commit just made)
and `STAMPED_AT` (current time, ISO 8601 with offset - `date -Iseconds`).

Why: this extension has no build step, so `chrome://extensions` reload is
the only way to pick up changes, and it's easy to think you reloaded when
you didn't. The popup shows `GIT_COMMIT`/`STAMPED_AT` so the loaded version
can be confirmed. A commit can't stamp its own hash, so the stamp always
lags the real commit by one metadata-only commit.

This is automated by `.githooks/post-commit` (enable once per clone with
`git config core.hooksPath .githooks`) - it creates the stamp commit
automatically after any non-stamp commit. If committing without that hook
enabled, do the stamp commit by hand instead of skipping it.
