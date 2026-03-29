import { useEffect, useState } from "react";

function getSlotRect(canvasRect, element) {
  if (!canvasRect || !element) {
    return null;
  }

  const rect = element.getBoundingClientRect();
  return {
    left: rect.left - canvasRect.left,
    right: rect.right - canvasRect.left,
    top: rect.top - canvasRect.top,
    bottom: rect.bottom - canvasRect.top,
    width: rect.width,
    height: rect.height,
    centerX: rect.left - canvasRect.left + rect.width / 2,
    centerY: rect.top - canvasRect.top + rect.height / 2,
  };
}

function buildHorizontalPath(fromRect, toRect) {
  const startX = fromRect.right;
  const startY = fromRect.centerY;
  const endX = toRect.left;
  const endY = toRect.centerY;
  const curve = Math.max(36, (endX - startX) * 0.42);

  return `M ${startX} ${startY} C ${startX + curve} ${startY}, ${endX - curve} ${endY}, ${endX} ${endY}`;
}

function buildVerticalBridgePath(fromRect, toRect) {
  const startX = fromRect.right;
  const startY = fromRect.centerY;
  const endX = toRect.left;
  const endY = toRect.centerY;
  const midX = startX + Math.max(18, (endX - startX) * 0.45);

  return `M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`;
}

export default function FamilyTreeConnectors({
  canvasRef,
  slotRefs,
  connectorPairs,
  highlightedEdgeTones = new Map(),
}) {
  const [geometry, setGeometry] = useState(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return undefined;
    }

    const recompute = () => {
      const canvasRect = canvas.getBoundingClientRect();
      setGeometry({
        width: canvas.scrollWidth,
        height: canvas.scrollHeight,
        lines: connectorPairs
          .map((pair) => {
            const fromRect = getSlotRect(canvasRect, slotRefs.current[pair.from]);
            const toRect = getSlotRect(canvasRect, slotRefs.current[pair.to]);

            if (!fromRect || !toRect) {
              return null;
            }

            return {
              key: `${pair.from}-${pair.to}`,
              tone: highlightedEdgeTones.get(`${pair.from}-${pair.to}`) ?? null,
              d:
                pair.kind === "bridge"
                  ? buildVerticalBridgePath(fromRect, toRect)
                  : buildHorizontalPath(fromRect, toRect),
            };
          })
          .filter(Boolean),
      });
    };

    const observer = new ResizeObserver(() => {
      recompute();
    });

    observer.observe(canvas);
    window.addEventListener("resize", recompute);
    const frame = requestAnimationFrame(recompute);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", recompute);
    };
  }, [canvasRef, connectorPairs, highlightedEdgeTones, slotRefs]);

  if (!geometry) {
    return null;
  }

  return (
    <svg
      className="family-tree-connectors"
      width={geometry.width}
      height={geometry.height}
      viewBox={`0 0 ${geometry.width} ${geometry.height}`}
      aria-hidden="true"
    >
      {geometry.lines.map((line) => (
        <path
          key={line.key}
          d={line.d}
          className={line.tone ? `is-highlighted is-highlighted-${line.tone}` : ""}
        />
      ))}
    </svg>
  );
}
