import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface BackButtonProps {
  to?: string;
  className?: string;
}

export function BackButton({ to, className }: BackButtonProps) {
  const navigate = useNavigate();

  return (
    <button
      onClick={() => (to ? navigate(to) : navigate(-1))}
      className={`flex items-center gap-2 text-[var(--color-brand)] hover:opacity-80 transition-opacity ${className || ''}`}
      title="Go back"
    >
      <ArrowLeft size={20} strokeWidth={2.5} />
    </button>
  );
}
