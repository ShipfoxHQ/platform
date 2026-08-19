import {isMarkdownPreferred, rewritePath} from 'fumadocs-core/negotiation';
import {type NextRequest, NextResponse} from 'next/server';

const {rewrite: rewriteLLM} = rewritePath('/{*path}', '/llms.mdx/{*path}');

export default function middleware(request: NextRequest) {
  if (isMarkdownPreferred(request)) {
    const result = rewriteLLM(request.nextUrl.pathname);
    if (result) {
      return NextResponse.rewrite(new URL(result, request.nextUrl));
    }
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|api|llms\\.txt|llms-full\\.txt|llms\\.mdx|shipfox-og\\.jpg|sitemap\\.xml|robots\\.txt|img).*)',
  ],
};
