export function isLocalHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

// Stops the tests from clearing tables anywhere but the test database.
export function assertLocalDatabase(url: string | undefined) {
  let hostname = "";
  try {
    hostname = new URL(url ?? "").hostname;
  } catch {}
  if (!isLocalHost(hostname)) throw new Error("Refusing to use a database that isn't on localhost.");
}
