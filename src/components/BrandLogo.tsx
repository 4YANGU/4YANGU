type BrandLogoProps = { className?: string; compact?: boolean; light?: boolean };

export default function BrandLogo({ className = '', compact = false, light = false }: BrandLogoProps) {
  return (
    <div className={`brand-lockup ${className}`} aria-label="StoYangu: My Store, My Hope">
      <img src="/stoyangu-logo.png" alt="StoYangu: My Store, My Hope" className={compact ? 'brand-logo-compact' : 'brand-logo'} />
      {light && <span className="sr-only">StoYangu</span>}
    </div>
  );
}
