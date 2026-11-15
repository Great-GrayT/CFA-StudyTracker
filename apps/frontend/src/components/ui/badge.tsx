import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

type BadgeVariantNames = 'default' | 'secondary' | 'destructive' | 'outline';

const badgeVariants = cva(
  'inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-hidden focus:ring-2 focus:ring-ring focus:ring-offset-2 gap-1.5',
  {
    variants: {
      variant: {
        default:
          'border-transparent bg-primary text-primary-foreground hover:bg-primary/80',
        secondary:
          'border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80',
        destructive:
          'border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80',
        outline: 'text-foreground',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {
  icon?: LucideIcon;
  iconPlacement?: 'start' | 'end';
  iconClassName?: string;
}

function Badge({
  className,
  variant,
  children,
  icon: Icon,
  iconPlacement = 'start',
  iconClassName,
  ...props
}: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props}>
      {Icon && iconPlacement === 'start' && (
        <Icon className={cn('h-3 w-3', iconClassName)} />
      )}
      {children}
      {Icon && iconPlacement === 'end' && (
        <Icon className={cn('h-3 w-3', iconClassName)} />
      )}
    </div>
  );
}

export { Badge, badgeVariants, type BadgeVariantNames };
