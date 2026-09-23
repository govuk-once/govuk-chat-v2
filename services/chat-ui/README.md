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

## Building the image

The image builds from the repo root, because pnpm keeps the lockfile there:

```
docker build -f services/chat-ui/Dockerfile -t chat-ui .
docker run --rm -p 3000:3000 chat-ui
```

`next build` runs only inside this Docker build.
