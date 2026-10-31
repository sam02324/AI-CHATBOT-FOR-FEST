// Route handlers are called directly with a real Request.
export function request(path: string, method = "GET", body?: unknown) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function withId(id: string) {
  return { params: Promise.resolve({ id }) };
}
