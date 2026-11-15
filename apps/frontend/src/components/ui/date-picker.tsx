'use client';

import * as React from 'react';
import { format } from 'date-fns';
import { Calendar as CalendarIcon } from 'lucide-react';
import { DateRange } from 'react-day-picker';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

// Controlled when value is passed; uncontrolled otherwise, as it shipped.
export function DatePicker({
  className,
  value,
  onChange,
  id = 'date',
  disabled,
  max,
  placeholder = 'Pick a date',
  'aria-describedby': describedBy,
}: Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange'> & {
  value?: Date;
  onChange?: (date: Date | undefined) => void;
  id?: string;
  disabled?: boolean;
  /** Last selectable day, inclusive. */
  max?: Date;
  placeholder?: string;
}) {
  const [inner, setInner] = React.useState<Date>();
  const [open, setOpen] = React.useState(false);
  const date = value !== undefined || onChange ? value : inner;

  return (
    <div className={cn('grid gap-2', className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            variant={'outline'}
            disabled={disabled}
            aria-describedby={describedBy}
            className={cn(
              'w-full justify-start text-left font-normal tabular-nums',
              !date && 'text-muted-foreground'
            )}
          >
            <CalendarIcon className="h-4 w-4" />
            {date ? format(date, 'EEE d MMM yyyy') : <span>{placeholder}</span>}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={date}
            defaultMonth={date}
            onSelect={(d) => {
              if (onChange) onChange(d);
              else setInner(d);
              setOpen(false);
            }}
            disabled={max ? { after: max } : undefined}
            initialFocus
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

export function DateRangePicker({
  className,
}: React.HTMLAttributes<HTMLDivElement>) {
  const [date, setDate] = React.useState<DateRange | undefined>();

  return (
    <div className={cn('grid gap-2', className)}>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            id="date"
            variant={'outline'}
            className={cn(
              'w-full justify-start text-left font-normal',
              !date && 'text-muted-foreground'
            )}
          >
            <CalendarIcon className="h-4 w-4" />
            {date?.from ? (
              date.to ? (
                <>
                  {format(date.from, 'LLL dd, y')} -{' '}
                  {format(date.to, 'LLL dd, y')}
                </>
              ) : (
                format(date.from, 'LLL dd, y')
              )
            ) : (
              <span>Pick a date range</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            initialFocus
            mode="range"
            defaultMonth={date?.from}
            selected={date}
            onSelect={setDate}
            numberOfMonths={2}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
