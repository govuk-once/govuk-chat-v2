# Chat UI

A Next.js web app for trying out the Chat API in a browser. For now it serves
a placeholder page and a `/api/health` route, and does not call the Chat API.

## Usage

To run it on your own machine:

```
./scripts/dev.sh
```

The page is at http://localhost:3000 and the health check at
http://localhost:3000/api/health. Arguments are passed to `next dev`, so
`./scripts/dev.sh --port 3001` picks another port.
