import { cn } from '@/lib/utils';

interface PageBoxProps {
  children: React.ReactNode;
  className?: string;
}

export function PageBox({ children, className }: PageBoxProps) {
  return (
    <div
      className={cn(
        'h-full flex flex-col bg-[var(--surface)] rounded-2xl overflow-hidden shadow-sm',
        className
      )}
    >
      {children}
    </div>
  );
}
