# Decision log

Prior to us putting together more formal ADR type documents, this keeps a brief list of key decisions made in prototyping.

## 1. Use Python as main lanugage

- Python is the most common language in the AI space, with the richest library support
- Python is a GDS supported language
- Python has first class AWS support and fast cold start times on AWS Lambda
- Python is often the default language of those working in the AI / Data space, particularly data scientists, and thus we want a cleaner route from prototype to production than we've previously had porting between languages.

## 1. Use TypeScript/NodeJS for AWS CDK

- While CDK supports Python, the App & AI Platform team only currently have resources in TypeScript
- The platform team expects to support Python in future as well as TypeScript, but no concrete commitments
- We don't yet know how heavily we'll rely on internal dependencies for CDK, but it seems unnecessary to cut this off at a language level in the short term
- On Chat team we already expect to have to work with JS somewhat so don't expect infra being written in TS to be a significant impedement or inconvenience at this stage.
