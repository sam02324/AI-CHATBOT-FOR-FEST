// Temporary deployment check. Reports only presence and key type, never values.
export const dynamic = "force-dynamic";

function describe(name: string, prefixes: string[]) {
  const value = process.env[name];
  if (value === undefined) return { name, present: false };
  return {
    name,
    present: true,
    empty: value.length === 0,
    type: prefixes.find((prefix) => value.startsWith(prefix)) ?? "unexpected start",
    hasSurroundingSpace: value !== value.trim(),
    hasQuotes: /^["']|["']$/.test(value),
  };
}

export async function GET() {
  return Response.json({
    node: process.version,
    vercelEnv: process.env.VERCEL_ENV ?? null,
    variables: [
      describe("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", ["pk_test_", "pk_live_"]),
      describe("CLERK_SECRET_KEY", ["sk_test_", "sk_live_"]),
      describe("ANTHROPIC_API_KEY", ["sk-ant-"]),
      describe("DATABASE_URL", ["postgresql://", "postgres://"]),
    ],
  });
}
