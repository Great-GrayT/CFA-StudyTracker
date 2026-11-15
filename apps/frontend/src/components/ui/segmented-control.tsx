'use client';

import * as React from 'react';
import { ToggleGroup } from 'radix-ui';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const segmentedControlRootVariants = cva(
  'inline-flex items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground',
  {
    variants: {
      size: {
        default: 'h-9',
        sm: 'h-8',
        lg: 'h-10',
      },
    },
    defaultVariants: {
      size: 'default',
    },
  }
);

const segmentedControlItemVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-hidden disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-background data-[state=on]:text-foreground hover:bg-background/50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      size: {
        default: 'px-3 py-1 min-w-[2.25rem]',
        sm: 'px-2 py-0.5 min-w-8 text-xs',
        lg: 'px-4 py-1.5 min-w-10',
      },
    },
    defaultVariants: {
      size: 'default',
    },
  }
);

function SegmentedControlRoot({
  className,
  size,
  ...props
}: React.ComponentProps<typeof ToggleGroup.Root> &
  VariantProps<typeof segmentedControlRootVariants>) {
  return (
    <ToggleGroup.Root
      data-slot="segmented-control-root"
      className={cn(segmentedControlRootVariants({ size, className }))}
      {...props}
    />
  );
}

function SegmentedControlItem({
  className,
  size,
  ...props
}: React.ComponentProps<typeof ToggleGroup.Item> &
  VariantProps<typeof segmentedControlItemVariants>) {
  return (
    <ToggleGroup.Item
      data-slot="segmented-control-item"
      className={cn(segmentedControlItemVariants({ size, className }))}
      {...props}
    />
  );
}

const SegmentedControl = {
  Root: SegmentedControlRoot,
  Item: SegmentedControlItem,
};

export {
  SegmentedControl,
  SegmentedControlRoot,
  SegmentedControlItem,
  segmentedControlRootVariants,
  segmentedControlItemVariants,
};

// Usage example:
// <SegmentedControl.Root defaultValue="inbox">
//   <SegmentedControl.Item value="inbox">Inbox</SegmentedControl.Item>
//   <SegmentedControl.Item value="drafts">Drafts</SegmentedControl.Item>
//   <SegmentedControl.Item value="sent">Sent</SegmentedControl.Item>
// </SegmentedControl.Root>
