# Decision log

Prior to us putting together more formal ADR type documents, this keeps a brief list of key decisions made in prototyping.

## 1. Use Python as main lanugage

- Python is the most common language in the AI space, with the richest library support
- Python is a GDS supported language
- Python has first class AWS support and fast cold start times on AWS Lambda
- Python is often the default language of those working in the AI / Data space, particularly data scientists, and thus we want a cleaner route from prototype to production than we've previously had porting between languages.
