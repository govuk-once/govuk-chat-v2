// The entry point the Lambda web function runtime starts, from the root of
// the deployment package. Lambda gives the address to listen on as
// AWS_LAMBDA_HTTP_ENDPOINT, in host:port form, while the Next.js standalone
// server reads HOSTNAME and PORT.
//
// Written as plain JavaScript, as the runtime starts it without a build step,
// and without top-level await, so it loads whether the runtime requires or
// imports it.
import process from 'node:process';

const [hostname, port] = (process.env.AWS_LAMBDA_HTTP_ENDPOINT ?? '').split(
  ':',
  2,
);
process.env.HOSTNAME = hostname;
process.env.PORT = port;

// With outputFileTracingRoot at the repo root, the standalone output keeps
// the workspace layout, so server.js sits under services/demo-ui.
import('./services/demo-ui/server.js');
