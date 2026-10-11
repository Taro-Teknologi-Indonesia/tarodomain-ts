# Changesets

Packages in this repo are versioned **independently** with [Changesets](https://github.com/changesets/changesets).

When a change should ship, run `pnpm changeset`, pick the affected packages and bump types, and commit the generated file with your change. The release workflow consumes these files to bump versions, write changelogs and publish to npm.
