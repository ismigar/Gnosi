import type { CSSProperties, ReactNode, KeyboardEvent, MouseEvent } from 'react';
import type { LucideIcon } from 'lucide-react';

export type ToggleEvent = KeyboardEvent<HTMLDivElement> | MouseEvent<HTMLDivElement>;
export interface ToggleProps {
  active?: boolean | null;
  onChange?: (event: ToggleEvent) => void;
  label?: string;
  style?: CSSProperties;
  scale?: number;
  display?: boolean;
}
export interface SectionProps {
  title: ReactNode;
  icon?: LucideIcon;
  children?: ReactNode;
  extra?: ReactNode;
}
export interface FormGroupProps {
  label?: ReactNode;
  children?: ReactNode;
  description?: ReactNode;
  horizontal?: boolean;
}
