export function PlaceholderScreen({ title, description }: { title: string; description: string }) {
  return (
    <div className="app-shell">
      <div className="card placeholder-card">
        <h2 className="placeholder-title">{title}</h2>
        <p className="muted">{description}</p>
      </div>
    </div>
  );
}
