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

For Python, install [uv](https://docs.astral.sh/uv/getting-started/installation/). This can be used to install the relevant python version with `uv python install`.

## Decisions

There is a [decision log](decisions.md).
