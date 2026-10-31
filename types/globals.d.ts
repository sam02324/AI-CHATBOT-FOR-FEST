export {};

declare global {
  // Present when the Clerk session token is customised to include public metadata. See README.md.
  interface CustomJwtSessionClaims {
    metadata?: { role?: string };
  }
}
