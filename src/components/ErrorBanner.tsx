interface ErrorBannerProps {
  error: string | null;
  onDismiss: () => void;
}

export default function ErrorBanner({ error, onDismiss }: ErrorBannerProps) {
  if (!error) return null;

  return (
    <div className="mb-4 p-3 rounded-lg bg-accent-danger text-fg-on-accent text-sm flex justify-between items-center">
      <span>{error}</span>
      <button onClick={onDismiss} className="ml-2 font-bold cursor-pointer">
        ×
      </button>
    </div>
  );
}
