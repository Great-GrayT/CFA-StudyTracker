'use client';

import * as React from 'react';
import { Check, ChevronsUpDown, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Drawer, DrawerContent, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer';
import { useMediaQuery } from '@/hooks/ui/use-media-query';
import { Badge } from '@/components/ui/badge';

export interface ComboboxItem {
  value: string;
  label: string;
}

interface ComboboxProps {
  data: ComboboxItem[];
  isLoading?: boolean;
  isError?: boolean;
  placeholder?: string;
  searchPlaceholder?: string;
  noResultsText?: string;
  className?: string;
  multiple?: boolean;
  onChange?: (value: string | string[]) => void;
  value?: string | string[];
  defaultValue?: string | string[];
  maxDisplayItems?: number;
  id?: string;
  disabled?: boolean;
  'aria-labelledby'?: string;
}

const DEFAULT_MAX_DISPLAY_ITEMS = 1;

// ComboboxContent component with virtualization support
const ComboboxContent = ({
  data,
  value,
  handleSelect,
  searchPlaceholder,
  noResultsText,
  className,
  multiple,
  selectedItems,
  handleRemoveItem,
}: {
  data: ComboboxItem[];
  value: string | string[];
  handleSelect: (currentValue: string) => void;
  searchPlaceholder: string;
  noResultsText: string;
  className?: string;
  multiple?: boolean;
  selectedItems: ComboboxItem[];
  handleRemoveItem: (value: string, e: React.MouseEvent) => void;
}) => {
  const [inputValue, setInputValue] = React.useState('');

  const isSelected = (itemValue: string) => {
    if (multiple) {
      return Array.isArray(value) && value.includes(itemValue);
    }
    return value === itemValue;
  };

  // cmdk filters its own mounted items, so the list is not virtualized.
  const renderItems = () =>
    data.map((item) => (
      <CommandItem
        key={item.value}
        value={item.label}
        keywords={[item.value]}
        onSelect={() => handleSelect(item.value)}
      >
        <div className="flex w-full items-center justify-between">
          <span className="flex-1">{item.label}</span>
          <Check
            className={cn(
              'ml-2 size-4',
              isSelected(item.value) ? 'opacity-100' : 'opacity-0'
            )}
          />
        </div>
      </CommandItem>
    ));

  return (
    <Command className={cn('overflow-hidden', className)}>
      {multiple && selectedItems.length > 0 && (
        <div className="border-b p-2 pt-0">
          <div className="mt-2 flex max-w-full flex-wrap gap-1">
            {selectedItems.map((item) => (
              <Badge key={item.value} variant="secondary" className="mr-1 mb-1">
                {item.label}
                <X
                  className="ml-1 size-3 cursor-pointer"
                  onClick={(e) => handleRemoveItem(item.value, e)}
                />
              </Badge>
            ))}
          </div>
        </div>
      )}
      <CommandInput
        placeholder={searchPlaceholder}
        value={inputValue}
        onValueChange={setInputValue}
      />
      <CommandList className="max-h-[300px] overflow-auto">
        <CommandEmpty>{noResultsText}</CommandEmpty>
        <CommandGroup>{renderItems()}</CommandGroup>
      </CommandList>
    </Command>
  );
};

export function Combobox({
  data,
  isLoading = false,
  isError = false,
  placeholder = 'Select option...',
  searchPlaceholder = 'Search...',
  noResultsText = 'No results found.',
  className,
  onChange,
  value: controlledValue,
  defaultValue = '',
  multiple = false,
  maxDisplayItems = DEFAULT_MAX_DISPLAY_ITEMS,
  id,
  disabled = false,
  'aria-labelledby': labelledBy,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false);

  // Initialize internal value based on multiple mode
  const initialInternalValue = multiple
    ? Array.isArray(defaultValue)
      ? defaultValue
      : defaultValue
        ? [defaultValue]
        : []
    : Array.isArray(defaultValue)
      ? defaultValue[0] || ''
      : defaultValue;

  const [internalValue, setInternalValue] = React.useState<string | string[]>(
    initialInternalValue
  );

  const isDesktop = useMediaQuery('(min-width: 768px)');

  const isControlled = controlledValue !== undefined;
  const value = isControlled ? controlledValue : internalValue;

  const handleSelect = React.useCallback(
    (currentValue: string) => {
      if (multiple) {
        // Handle multiple selection
        const currentValues = Array.isArray(value)
          ? value
          : value
            ? [value]
            : [];
        const newValue = currentValues.includes(currentValue)
          ? currentValues.filter((v) => v !== currentValue)
          : [...currentValues, currentValue];

        if (!isControlled) {
          setInternalValue(newValue);
        }
        onChange?.(newValue);

        // Don't close the popover/drawer in multiple mode
      } else {
        // Handle single selection (original behavior)
        // Reselecting keeps the value: a fast repeat Enter must not clear a field.
        const newValue = currentValue;
        if (!isControlled) {
          setInternalValue(newValue);
        }
        onChange?.(newValue);
        setOpen(false);
      }
    },
    [value, isControlled, onChange, multiple]
  );

  // Remove a selected item directly (for multiple mode badges)
  const handleRemoveItem = React.useCallback(
    (itemValue: string, e: React.MouseEvent) => {
      e.stopPropagation(); // Prevent opening the dropdown

      if (multiple && Array.isArray(value)) {
        const newValue = value.filter((v) => v !== itemValue);
        if (!isControlled) {
          setInternalValue(newValue);
        }
        onChange?.(newValue);
      }
    },
    [value, isControlled, onChange, multiple]
  );

  // Get selected items for display
  const getSelectedItems = () => {
    if (multiple && Array.isArray(value)) {
      return value.map((val) => data.find((item) => item.value === val));
    } else if (value) {
      return [data.find((item) => item.value === value)];
    }
    return [];
  };

  const selectedItems = getSelectedItems().filter(Boolean) as ComboboxItem[];

  if (isError) {
    return (
      <Button
        variant="outline"
        className={cn('text-destructive w-[200px] justify-between', className)}
        disabled
      >
        Could not load options
      </Button>
    );
  }

  // Render selected items content with summary for multiple items
  const renderSelectedContent = () => {
    if (isLoading) {
      return 'Loading...';
    }

    if (multiple) {
      if (selectedItems.length === 0) {
        return placeholder;
      }

      // Show count when there are more items than the limit
      if (selectedItems.length > maxDisplayItems) {
        const displayedItems = selectedItems.slice(0, maxDisplayItems);

        return (
          <div className="flex items-center truncate">
            {displayedItems.length > 0 && (
              <Badge variant="secondary" className="mr-1">
                {displayedItems[0].label}
              </Badge>
            )}
            <span className="text-warning mr-1 text-sm font-bold">
              {selectedItems.length - maxDisplayItems}+
            </span>
          </div>
        );
      }

      // If fewer than the limit, show them all
      return (
        <div className="flex flex-wrap items-center gap-1 truncate">
          {selectedItems.map((item) => (
            <Badge key={item.value} variant="secondary" className="mr-1">
              {item.label}
            </Badge>
          ))}
        </div>
      );
    } else {
      return selectedItems[0]?.label || placeholder;
    }
  };

  if (isDesktop) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-labelledby={labelledBy}
            className={cn(
              'min-h-10 w-[200px] justify-between',
              multiple && 'flex-wrap',
              className
            )}
            disabled={isLoading || disabled}
          >
            <div className="flex flex-1 items-center overflow-hidden">
              <span className="truncate">{renderSelectedContent()}</span>
            </div>
            <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-(--radix-popover-trigger-width) min-w-[200px] p-0"
          align="start"
          sideOffset={4}
        >
          <ComboboxContent
            data={data}
            value={value}
            handleSelect={handleSelect}
            searchPlaceholder={searchPlaceholder}
            noResultsText={noResultsText}
            className={className}
            multiple={multiple}
            selectedItems={selectedItems}
            handleRemoveItem={handleRemoveItem}
          />
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <Button
          id={id}
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-labelledby={labelledBy}
          className={cn(
            'min-h-10 w-[150px] justify-start',
            multiple && 'flex-wrap',
            className
          )}
          disabled={isLoading || disabled}
        >
          <div className="flex flex-1 items-center overflow-hidden">
            <span className="truncate">{renderSelectedContent()}</span>
          </div>
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </DrawerTrigger>
      <DrawerContent aria-describedby={undefined}>
        {/* Radix requires a dialog title; the placeholder names the choice. */}
        <DrawerTitle className="sr-only">{placeholder}</DrawerTitle>
        <div className="mt-4 border-t p-4">
          <ComboboxContent
            data={data}
            value={value}
            handleSelect={handleSelect}
            searchPlaceholder={searchPlaceholder}
            noResultsText={noResultsText}
            className={className}
            multiple={multiple}
            selectedItems={selectedItems}
            handleRemoveItem={handleRemoveItem}
          />
        </div>
      </DrawerContent>
    </Drawer>
  );
}
