import { useState } from 'react';

function isImageUrl(value: string): boolean {
  const trimmed = value.trim();
  return /^https?:\/\/|^data:image\//i.test(trimmed) || /\.(png|jpe?g|gif|webp|svg|ico|avif)(\?|#|$)/i.test(trimmed);
}

interface IconDisplayProps {
  icon: string;
  fallback?: string;
  className?: string;
  imgClassName?: string;
}

export default function IconDisplay({ icon, fallback = '🏢', className, imgClassName }: IconDisplayProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const value = icon?.trim() || '';
  const failed = Boolean(value) && failedSrc === value;
  if (!value && !fallback) return null;

  if (value && isImageUrl(value) && !failed) {
    return (
      <img
        src={value}
        alt=""
        className={imgClassName ?? 'size-4 object-contain'}
        onError={() => setFailedSrc(value)}
      />
    );
  }

  // Failed image URLs fall back to emoji/text — never render the raw URL.
  const display = value && !isImageUrl(value) ? value : fallback;
  if (!display) return null;
  return <span className={className ?? 'flex size-4 items-center justify-center text-sm leading-none'}>{display}</span>;
}
