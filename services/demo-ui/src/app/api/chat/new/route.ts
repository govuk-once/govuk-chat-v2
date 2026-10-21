import { NextResponse } from 'next/server';
import { clearThreadId } from '../cookies.ts';

export function POST(): NextResponse {
  // A relative redirect, because behind the load balancer `request.url` may
  // not carry the public host.
  const response = new NextResponse(undefined, {
    status: 303,
    headers: { Location: '/' },
  });
  clearThreadId(response);
  return response;
}
