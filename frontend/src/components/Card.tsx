import { cn } from '@/lib/utils';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  variant?: 'default' | 'note' | 'elevated' | 'flat';
  interactive?: boolean;
  onClick?: () => void;
}

const variantStyles = {
  default: 'bg-[var(--color-bg-card)] shadow-sm',
  note: 'bg-[var(--color-type-note-bg)] text-[var(--color-type-note-text)]',
  elevated: 'bg-[var(--color-bg-card)] shadow-md hover:shadow-xl',
  flat: 'bg-[var(--color-bg-card)] border border-[var(--color-border)]',
};

export function Card({
  children,
  className,
  variant = 'default',
  interactive = false,
  onClick,
}: CardProps) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'rounded-[28px] overflow-hidden',
        variantStyles[variant],
        interactive && 'cursor-pointer transition-all duration-[var(--duration-base)] ease-out hover:-translate-y-1',
        className
      )}
    >
      {children}
    </div>
  );
}

// Sub-components for consistent internal layout
Card.Header = function CardHeader({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn('p-7', className)}>{children}</div>;
};

Card.Body = function CardBody({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn('px-7 pb-7', className)}>{children}</div>;
};

Card.Footer = function CardFooter({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'px-7 py-5 border-t border-[var(--color-border)] flex items-center justify-between',
        className
      )}
    >
      {children}
    </div>
  );
};
