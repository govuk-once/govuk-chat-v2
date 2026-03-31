# GOV.UK Chat V2 prototype

A prototype structure to explore managing GOV.UK Chat services in
a monorepo to explore ideas for a v2.

GOV.UK Chat V2 is likely to be:

- Micro-service architecture, for small focused components,
- Monorepo, to try reduce the pain of working with micro-services
- Python as main backend language, to reduce work to take a concept to production
- Cloud-native, built directly to utilise AWS managed services
- Streaming as default output
- Agentic in assistant response

## Directory structure

- common: files common to multiple distinct sub-projects
- libs: shared libraries such as assitants or analysis
- utilities: standalone tools, such as evaluation suite
- services: microservices that form the suite of applications (e.g api, admin, frontends)

## Technical documentation

### Installing dependencies

This project uses Python and NodeJS

For Python, install [uv](https://docs.astral.sh/uv/getting-started/installation/).

For NodeJS, install [nvm](https://github.com/nvm-sh/nvm?tab=readme-ov-file#installing-and-updating).

You'll need to authenticate with AWS, this uses the [GDS CLI](https://github.com/alphagov/gds-cli).

To set-up your environment with ZSH then run `source dev-prepare.zsh`

If you don't use ZSH check the [dev-prepare.zsh](dev-prepare.zsh) script to check which commands to run.

<details>
<summary>If you see this error: `realpath: illegal option -- -`</summary>

This error means you're using the built-in macOS version of realpath and you need to install the GNU version instead.

You can install it by following these instructions:

```bash
brew install coreutils
```

Then add the coreutils path to your `$PATH` environment variable:

```
export PATH="/opt/homebrew/opt/coreutils/libexec/gnubin:$PATH"
```
</details>

## Decisions

There is a [decision log](decisions.md).
