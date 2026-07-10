# GOV.UK Chat V2 prototype

GOV.UK Chat V2 which is an API product to provide an AI powered chatbot for UK
government guidance and services. It is a successor to [GOV.UK Chat](https://github.com/alphagov/govuk-chat) (V1) and intended to be a foundational tool that acts a gateway and
orchestrator for a conversational interface to governemnt.

The three main factors that differentiate it from GOV.UK Chat V1 are:

- Agentic: LLM communication is done via an agentic loop which is intended as
  a foundation for an extensible conversational experience
- Streaming: LLM activity is communicated to an end user via web streaming
  protocols
- Cloud native: Purpose built to embrace AWS managed cloud services for
  reduced infrastructure management and maintenance.

Additionally, it differs from the GOV.UK Chat V1 by being:

- Developed as an API first product, GOV.UK Chat V1 began as a
  monolithic web application and was modified to have an API and thus the web
  experience does not use the API
- Change in software technologies, GOV.UK Chat V1 was built with Ruby-on-Rails,
  GOV.UK Chat V2 is built with TypeScript and Python to reflect the technology
  conventions of the App & AI part of GDS



## Working with this repository

There's an [AGENTS.md](AGENTS.md) that is just as useful for humans as agents.

## Technical documentation

### Installing dependencies

This project uses Python and NodeJS

For Python, install [uv](https://docs.astral.sh/uv/getting-started/installation/).

For NodeJS, install [nvm](https://github.com/nvm-sh/nvm?tab=readme-ov-file#installing-and-updating).

You'll need to authenticate with AWS, this uses the [GDS CLI](https://github.com/alphagov/gds-cli).

To set-up your environment with ZSH then run `source scripts/dev-prepare.zsh`

If you don't use ZSH check the [scripts/dev-prepare.zsh](scripts/dev-prepare.zsh)
script to check which commands to run.

## Decisions

There is a [decision log](decisions.md).
