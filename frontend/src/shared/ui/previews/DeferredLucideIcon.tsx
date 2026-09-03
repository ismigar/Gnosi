import { useEffect, useState, type ReactNode } from 'react';
import {
  Activity,
  BookOpen,
  Bot,
  Brain,
  Calendar,
  ChevronDown,
  Database,
  FileText,
  Folder,
  Heart,
  House,
  Mail,
  MessageCircle,
  PenTool,
  Rocket,
  Search,
  Shield,
  Sparkles,
  Star,
  Workflow,
  type LucideIcon,
  type LucideProps,
} from 'lucide-react';

type DynamicModule = typeof import('lucide-react/dynamic');

const STATIC_ICONS: Readonly<Record<string, LucideIcon | undefined>> = {
  activity: Activity,
  'book-open': BookOpen,
  bot: Bot,
  brain: Brain,
  calendar: Calendar,
  'chevron-down': ChevronDown,
  database: Database,
  'file-text': FileText,
  folder: Folder,
  heart: Heart,
  house: House,
  mail: Mail,
  'message-circle': MessageCircle,
  'pen-tool': PenTool,
  rocket: Rocket,
  search: Search,
  shield: Shield,
  sparkles: Sparkles,
  star: Star,
  workflow: Workflow,
};

let dynamicModulePromise: Promise<DynamicModule> | null = null;

function loadDynamicModule(): Promise<DynamicModule> {
  dynamicModulePromise ??= import('lucide-react/dynamic');
  return dynamicModulePromise;
}

function normalizeLucideIconName(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

interface DeferredLucideIconProps extends LucideProps {
  readonly invalidFallback?: ReactNode;
  readonly loadingFallback?: ReactNode;
  readonly name: string;
}

export function DeferredLucideIcon({
  invalidFallback = null,
  loadingFallback = null,
  name,
  ...iconProps
}: DeferredLucideIconProps) {
  const normalizedName = normalizeLucideIconName(name);
  const StaticIcon = STATIC_ICONS[normalizedName];
  const [dynamicModule, setDynamicModule] = useState<DynamicModule | null>(null);

  useEffect(() => {
    if (StaticIcon) return undefined;
    let active = true;
    void loadDynamicModule().then((loaded) => {
      if (active) setDynamicModule(loaded);
    });
    return () => { active = false; };
  }, [StaticIcon]);

  if (StaticIcon) {
    return <StaticIcon {...iconProps} data-icon={normalizedName} />;
  }
  if (!dynamicModule) return loadingFallback;
  const names: readonly string[] = dynamicModule.iconNames;
  if (!names.includes(normalizedName)) return invalidFallback;
  const DynamicIcon = dynamicModule.DynamicIcon;
  return (
    <DynamicIcon
      {...iconProps}
      data-icon={normalizedName}
      name={normalizedName as (typeof dynamicModule.iconNames)[number]}
    />
  );
}
