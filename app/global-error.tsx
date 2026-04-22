"use client";

export default function GlobalError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <html>
      <body>
        <div style={{ padding: 40, fontFamily: "sans-serif" }}>
          <h2>Algo deu errado</h2>
          <p>{error.message}</p>
          <button onClick={() => reset()}>Tentar novamente</button>
        </div>
      </body>
    </html>
  );
}
