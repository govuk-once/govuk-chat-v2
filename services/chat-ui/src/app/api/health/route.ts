export function GET() {
  return Response.json({
    status: 'ok',
    environment: process.env.ENVIRONMENT,
  });
}
