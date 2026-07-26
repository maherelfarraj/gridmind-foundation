// P-139 — Renders registry SVG markup inside the 40×40 symbol viewBox.
import { sanitizeSvgBody } from "@/lib/sld/symbol-registry";

export function SymbolGlyph({
  svg,
  size = 40,
  className,
}: {
  svg: string;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 40 40"
      width={size}
      height={size}
      aria-hidden="true"
      className={className}
      dangerouslySetInnerHTML={{ __html: sanitizeSvgBody(svg) }}
    />
  );
}

/** Glyph scaled into a sheet footprint (mm), centred on the object origin. */
export function CanvasGlyph({ svg, w, h }: { svg: string; w: number; h: number }) {
  return (
    <g
      transform={`translate(${-w / 2} ${-h / 2}) scale(${w / 40} ${h / 40})`}
      className="pointer-events-none"
      dangerouslySetInnerHTML={{ __html: sanitizeSvgBody(svg) }}
    />
  );
}
