import { DynamicIcon, iconNames, type IconName } from 'lucide-react/dynamic';
import { withActiveVault } from '../../lib/fileResource';

const DYNAMIC_ICON_NAMES: ReadonlySet<string> = new Set(iconNames);
const normalizeLucideIconName = (name: string): string => name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase();

const normalizeVaultAssetUrl = (value: string): string => {
    if (value.startsWith('Assets/')) {
        return `/api/vault/assets/${value.substring(7)}`;
    }

    if (value.startsWith('/api/vault/assets/')) {
        return value;
    }

    // Some legacy uploads were stored as absolute backend URLs (localhost:5002).
    const absAssetMatch = value.match(/^https?:\/\/[^/]+\/api\/vault\/assets\/(.+)$/i);
    if (absAssetMatch?.[1]) {
        return `/api/vault/assets/${absAssetMatch[1]}`;
    }

    return value;
};

/**
 * IconRenderer
 * 
 * Universal logic for rendering icons:
 * 1. Emoji (plain text)
 * 2. Lucide Icon (format "lucide:IconName:color")
 * 3. URL/Image (https://... or Assets/...)
 */
export interface IconRendererProps {
    readonly className?: string;
    readonly color?: string;
    readonly icon?: string | null;
    readonly size?: number;
}

export const IconRenderer = ({ icon, size = 16, className = '', color }: IconRendererProps) => {
    if (!icon) return null;

    // 1. Check if it's a Lucide Icon string "lucide:IconName:color"
    if (typeof icon === 'string' && icon.startsWith('lucide:')) {
        const parts = icon.split(':');
        const iconName = parts[1];
        const colorName = parts[2] || 'default';

        // Color map for icons
        const colorMap: Readonly<Record<string, string>> = {
            'default': 'currentColor',
            'gray': '#787774',
            'brown': '#976d57',
            'orange': '#d9730d',
            'yellow': '#dfab01',
            'green': '#0f7b6c',
            'blue': '#0b6e99',
            'purple': '#6940a5',
            'pink': '#ad1a72',
            'red': '#e03e3e'
        };

        const normalizedName = normalizeLucideIconName(iconName || '');
        if (DYNAMIC_ICON_NAMES.has(normalizedName)) {
            return <DynamicIcon name={normalizedName as IconName} size={size} color={color || colorMap[colorName] || 'currentColor'} className={className} />;
        }
    }

    // 2. Check if it's a URL or path
    if (typeof icon === 'string' && (icon.startsWith('http') || icon.startsWith('/') || icon.includes('.'))) {
        const normalizedUrl = normalizeVaultAssetUrl(icon);
        const activeVaultUrl: unknown = withActiveVault(normalizedUrl);
        const src = typeof activeVaultUrl === 'string' ? activeVaultUrl : normalizedUrl;

        return (
            <img
                src={src}
                alt="page icon"
                style={{ width: size, height: size, objectFit: 'cover', display: 'block' }}
                className={className}
            />
        );
    }

    // 3. Fallback: assume it's an emoji (standard text)
    return (
        <span
            className={`flex items-center justify-center shrink-0 ${className}`}
            style={{ fontSize: `${String(size * 0.8)}px`, width: size, height: size }}
        >
            {icon}
        </span>
    );
};
