export default function Home() {
  return (
    <main style={{ maxWidth: 640, margin: "48px auto", padding: "0 16px", lineHeight: 1.5 }}>
      <h1>Asli</h1>
      <p>Trust infrastructure for relief payments. <strong>Prototype only — not an official service. All data is simulated.</strong></p>
      <p>The frontend is in progress. The API is live:</p>
      <ul>
        <li><a href="/api/docs">API docs (Swagger UI)</a></li>
        <li><a href="/api/openapi.json">OpenAPI document</a></li>
        <li><a href="/api/health">Health</a></li>
        <li><a href="/api/v1/transparency">Public transparency numbers</a></li>
      </ul>
    </main>
  );
}
