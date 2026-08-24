import { useCallback, useState } from 'react';

interface ControllableBooleanOptions {
  value?: boolean;
  defaultValue: boolean;
  onChange?: (value: boolean) => void;
}

export function useControllableBoolean({
  value,
  defaultValue,
  onChange,
}: ControllableBooleanOptions): [boolean, (value: boolean) => void] {
  const [internalValue, setInternalValue] = useState(defaultValue);
  const isControlled = value !== undefined;
  const currentValue = isControlled ? value : internalValue;

  const setValue = useCallback(
    (nextValue: boolean) => {
      if (!isControlled) {
        setInternalValue(nextValue);
      }

      if (nextValue !== currentValue) {
        onChange?.(nextValue);
      }
    },
    [currentValue, isControlled, onChange],
  );

  return [currentValue, setValue];
}
