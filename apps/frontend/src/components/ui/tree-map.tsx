'use client';
import React, {
  useState,
  useRef,
  useEffect,
  useMemo,
  useCallback,
  CSSProperties,
} from 'react';
import { atom, useAtom } from 'jotai';
import { cn } from '@/lib/utils';
import { ChevronRight, Home } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useIsCut } from '@/components/states/truncated-text';

// Type Definitions
interface TreemapDataItem {
  id: string;
  name: string;
  value: number;
  parent?: string;
  color?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata?: Record<string, any>;
  children?: TreemapDataItem[];
}

interface TreemapNode extends TreemapDataItem {
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
  children?: TreemapNode[];
}

interface TreemapConfig {
  width?: number;
  height?: number;
  minCellSize?: number;
  animationDuration?: number;
  animationEnabled?: boolean;
  colorScheme?: 'default' | 'financial' | 'custom';
  customColors?: string[];
  showTooltip?: boolean;
  showBreadcrumb?: boolean;
  enableDrillDown?: boolean;
  enableKeyboardNavigation?: boolean;
  layout?: 'squarified' | 'horizontal' | 'vertical';
  padding?: number;
  borderRadius?: number;
  onCellClick?: (node: TreemapNode) => void;
  onDrillDown?: (node: TreemapNode) => void;
  renderCell?: (node: TreemapNode) => React.ReactNode;
  renderTooltip?: (node: TreemapNode) => React.ReactNode;
  /** False drops the click-to-select ring and aria-pressed. */
  selectable?: boolean;
  /** Accessible name per cell; the default reads the raw value. */
  getAriaLabel?: (node: TreemapNode) => string;
  /** Extra style per visible cell, e.g. a staggered entrance. */
  cellStyle?: (node: TreemapNode, index: number) => CSSProperties;
  /** Visible label for the breadcrumb's root; an icon when absent. */
  rootLabel?: string;
  ariaLabel?: string;
}

// Jotai atoms for state management
const drillDownPathAtom = atom<string[]>([]);
const hoveredNodeAtom = atom<TreemapNode | null>(null);
const selectedNodesAtom = atom<Set<string>>(new Set<string>());

// Squarified Treemap Algorithm
const calculateSquarifiedLayout = (
  nodes: TreemapDataItem[],
  x: number,
  y: number,
  width: number,
  height: number,
  depth: number = 0
): TreemapNode[] => {
  if (!nodes.length) return [];

  const totalValue = nodes.reduce((sum, node) => sum + node.value, 0);
  if (totalValue <= 0) return [];

  const sortedNodes = [...nodes].sort((a, b) => b.value - a.value);
  const result: TreemapNode[] = [];

  const calculateWorstAspectRatio = (
    row: TreemapDataItem[],
    w: number,
    h: number
  ) => {
    const s = row.reduce((sum, node) => sum + node.value, 0);
    const rowMax = Math.max(...row.map((n) => n.value));
    const rowMin = Math.min(...row.map((n) => n.value));
    const ratio1 = (w * w * rowMax) / (h * h * s);
    const ratio2 = (h * h * s) / (w * w * rowMin);
    return Math.max(ratio1, ratio2);
  };

  const layoutRow = (
    row: TreemapDataItem[],
    x: number,
    y: number,
    w: number,
    h: number
  ) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const rowValue = row.reduce((sum, node) => sum + node.value, 0);
    const scale = totalValue > 0 ? (w * h) / totalValue : 0;

    let currentX = x;
    let currentY = y;

    row.forEach((node) => {
      const nodeArea = node.value * scale;
      let nodeWidth, nodeHeight;

      if (w > h) {
        nodeWidth = nodeArea / h;
        nodeHeight = h;
      } else {
        nodeWidth = w;
        nodeHeight = nodeArea / w;
      }

      const treeNode: TreemapNode = {
        ...node,
        x: currentX,
        y: currentY,
        width: nodeWidth,
        height: nodeHeight,
        depth,
        children: node.children
          ? calculateSquarifiedLayout(
              node.children,
              currentX,
              currentY,
              nodeWidth,
              nodeHeight,
              depth + 1
            )
          : undefined,
      };

      result.push(treeNode);

      if (w > h) {
        currentX += nodeWidth;
      } else {
        currentY += nodeHeight;
      }
    });
  };

  let remainingNodes = sortedNodes;
  let currentX = x;
  let currentY = y;
  let remainingWidth = width;
  let remainingHeight = height;

  while (remainingNodes.length > 0) {
    const shortSide = Math.min(remainingWidth, remainingHeight);
    const row: TreemapDataItem[] = [];
    let worstRatio = Infinity;

    for (const node of remainingNodes) {
      const testRow = [...row, node];
      const testRatio = calculateWorstAspectRatio(
        testRow,
        shortSide === remainingWidth ? remainingWidth : remainingHeight,
        shortSide === remainingWidth ? remainingHeight : remainingWidth
      );

      if (testRatio < worstRatio || row.length === 0) {
        row.push(node);
        worstRatio = testRatio;
      } else {
        break;
      }
    }

    const rowValue = row.reduce((sum, node) => sum + node.value, 0);
    const rowRatio = rowValue / totalValue;

    if (remainingWidth > remainingHeight) {
      const rowWidth = remainingWidth * rowRatio;
      layoutRow(row, currentX, currentY, rowWidth, remainingHeight);
      currentX += rowWidth;
      remainingWidth -= rowWidth;
    } else {
      const rowHeight = remainingHeight * rowRatio;
      layoutRow(row, currentX, currentY, remainingWidth, rowHeight);
      currentY += rowHeight;
      remainingHeight -= rowHeight;
    }

    remainingNodes = remainingNodes.slice(row.length);
  }

  return result;
};

// Color utilities
const getFinancialColor = (value: number, baseValue: number = 0): string => {
  const change = ((value - baseValue) / baseValue) * 100;
  if (change > 2) return 'rgb(34, 197, 94)'; // green-500
  if (change > 0) return 'rgb(74, 222, 128)'; // green-400
  if (change < -2) return 'rgb(239, 68, 68)'; // red-500
  if (change < 0) return 'rgb(248, 113, 113)'; // red-400
  return 'rgb(148, 163, 184)'; // slate-400
};

// TreemapCell Component
const TreemapCell: React.FC<{
  node: TreemapNode;
  config: TreemapConfig;
  onCellClick?: (node: TreemapNode) => void;
  onDrillDown?: (node: TreemapNode) => void;
  index?: number;
} & Omit<React.HTMLAttributes<HTMLDivElement>, 'style'> & {
  ref?: React.Ref<HTMLDivElement>;
}> = ({ node, config, onCellClick, onDrillDown, index = 0, ref, ...rest }) => {
  const [hoveredNode, setHoveredNode] = useAtom(hoveredNodeAtom);
  const [selectedNodes, setSelectedNodes] = useAtom(selectedNodesAtom);
  const cellRef = useRef<HTMLDivElement>(null);

  const selectable = config.selectable !== false;
  const isSelected = selectable && selectedNodes.has(node.id);
  const isHovered = hoveredNode?.id === node.id;
  // ?? not ||: a minCellSize of 0 means draw every cell.
  const showCell =
    node.width >= (config.minCellSize ?? 20) &&
    node.height >= (config.minCellSize ?? 20);

  const handleNodeAction = useCallback(() => {
    if (node.children && config.enableDrillDown && onDrillDown) {
      onDrillDown(node);
    } else if (onCellClick) {
      onCellClick(node);
    }

    if (selectable) setSelectedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(node.id)) {
        next.delete(node.id);
      } else {
        next.add(node.id);
      }
      return next;
    });
  }, [
    node,
    config.enableDrillDown,
    onCellClick,
    onDrillDown,
    setSelectedNodes,
    selectable,
  ]);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      rest.onClick?.(e);
      e.stopPropagation();
      handleNodeAction();
    },
    [handleNodeAction, rest]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      rest.onKeyDown?.(e);
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleNodeAction();
      }
    },
    [handleNodeAction, rest]
  );

  if (!showCell) return null;

  const cellStyle: CSSProperties = {
    position: 'absolute',
    left: `${node.x}px`,
    top: `${node.y}px`,
    width: `${node.width}px`,
    height: `${node.height}px`,
    transition:
      config.animationEnabled !== false
        ? `all ${config.animationDuration || 300}ms cubic-bezier(0.4, 0, 0.2, 1)`
        : undefined,
    ...config.cellStyle?.(node, index),
  };

  const cellColor =
    node.color ||
    (config.colorScheme === 'financial'
      ? getFinancialColor(node.value, 100)
      : undefined);

  return (
    <div
      {...rest}
      ref={(el) => {
        cellRef.current = el;
        if (typeof ref === 'function') ref(el);
        else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = el;
      }}
      style={cellStyle}
      className={cn(
        'cursor-pointer overflow-hidden',
        // Inset, since the container clips; two-tone, so it shows on any fill.
        'focus-visible:z-10 focus-visible:shadow-[inset_0_0_0_2px_var(--focus),inset_0_0_0_4px_var(--ground)] focus-visible:outline-none',
        isSelected && 'ring-primary ring-2 ring-inset',
        isHovered && 'brightness-110',
        rest.className
      )}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onMouseEnter={(e) => {
        rest.onMouseEnter?.(e);
        setHoveredNode(node);
      }}
      onMouseLeave={(e) => {
        rest.onMouseLeave?.(e);
        setHoveredNode(null);
      }}
      tabIndex={0}
      role="button"
      aria-label={config.getAriaLabel ? config.getAriaLabel(node) : `${node.name}: ${node.value}`}
      aria-pressed={selectable ? isSelected : undefined}
      data-slot="treemap-cell"
    >
      <div
        className={cn(
          'absolute inset-0 flex flex-col items-center justify-center p-2',
          'border-background bg-card border',
          config.borderRadius === 0 ? 'rounded-none' : `rounded-${config.borderRadius || 'md'}`
        )}
        style={{ backgroundColor: cellColor }}
      >
        {config.renderCell ? (
          config.renderCell(node)
        ) : (
          <>
            <div className="w-full truncate text-center text-sm font-medium text-slate-900 dark:text-slate-100">
              {node.name}
            </div>
            {node.height > 40 && (
              <div className="text-xs text-slate-700 dark:text-slate-300">
                {node.value.toLocaleString()}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

// A crumb that names itself in a tooltip only when its label is cut.
const Crumb: React.FC<{
  label: string;
  className: string;
  current: boolean;
  onClick: () => void;
}> = ({ label, className, current, onClick }) => {
  const ref = useRef<HTMLButtonElement>(null);
  const cut = useIsCut(ref, label);
  return (
    <Tooltip open={cut ? undefined : false}>
      <TooltipTrigger asChild>
        <button
          ref={ref}
          type="button"
          onClick={onClick}
          aria-current={current ? 'page' : undefined}
          className={className}
        >
          {label}
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{label}</TooltipContent>
    </Tooltip>
  );
};

// TreemapBreadcrumb Component
const TreemapBreadcrumb: React.FC<{
  path: string[];
  onNavigate: (index: number) => void;
  rootLabel?: string;
}> = ({ path, onNavigate, rootLabel }) => {
  const crumb =
    'hover:text-primary focus-visible:ring-ring min-w-0 truncate rounded-sm outline-hidden focus-visible:ring-2 max-md:py-3.5';
  return (
    <nav
      className="mb-2 flex min-w-0 items-center gap-1.5 text-[13px]"
      aria-label="Breadcrumb"
    >
      <button
        type="button"
        onClick={() => onNavigate(0)}
        className={cn(crumb, 'flex shrink-0 items-center')}
        aria-label={rootLabel ? undefined : 'Navigate to root'}
      >
        {rootLabel ?? <Home className="h-4 w-4" />}
      </button>
      {path.map((item, index) => (
        <React.Fragment key={index}>
          <ChevronRight className="text-muted-foreground h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <Crumb
            label={item}
            onClick={() => onNavigate(index + 1)}
            current={index === path.length - 1}
            className={cn(crumb, 'block', index === path.length - 1 && 'text-foreground font-medium')}
          />
        </React.Fragment>
      ))}
    </nav>
  );
};

// Main TreemapContainer Component
const TreemapContainer: React.FC<{
  data: TreemapDataItem[];
  config?: TreemapConfig;
}> = ({ data, config = {} }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [drillDownPath, setDrillDownPath] = useAtom(drillDownPathAtom);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [hoveredNode] = useAtom(hoveredNodeAtom);

  // Handle responsive sizing
  useEffect(() => {
    if (!containerRef.current) return;

    const updateDimensions = () => {
      const { width, height } = containerRef.current!.getBoundingClientRect();
      setDimensions({
        width: config.width || width,
        height: config.height || height,
      });
    };

    updateDimensions();
    const observer = new ResizeObserver(updateDimensions);
    observer.observe(containerRef.current);

    return () => observer.disconnect();
  }, [config.width, config.height]);

  // Calculate visible nodes based on drill-down path
  const visibleNodes = useMemo(() => {
    let currentNodes = data;

    for (const pathId of drillDownPath) {
      const findNode = (
        nodes: TreemapDataItem[]
      ): TreemapDataItem | undefined => {
        for (const node of nodes) {
          if (node.id === pathId) return node;
          if (node.children) {
            const found = findNode(node.children);
            if (found) return found;
          }
        }
        return undefined;
      };

      const node = findNode(currentNodes);
      if (node?.children) {
        currentNodes = node.children;
      }
    }

    return currentNodes;
  }, [data, drillDownPath]);

  // Calculate layout
  const layoutNodes = useMemo(() => {
    const padding = config.padding || 2;
    return calculateSquarifiedLayout(
      visibleNodes,
      padding,
      padding,
      dimensions.width - padding * 2,
      dimensions.height - padding * 2
    );
  }, [visibleNodes, dimensions, config.padding]);

  const handleDrillDown = useCallback(
    (node: TreemapNode) => {
      if (node.children?.length) {
        setDrillDownPath((prev) => [...prev, node.id]);
        config.onDrillDown?.(node);
      }
    },
    [setDrillDownPath, config]
  );

  const handleBreadcrumbNavigate = useCallback(
    (index: number) => {
      setDrillDownPath((prev) => prev.slice(0, index));
    },
    [setDrillDownPath]
  );

  // Keyboard navigation
  useEffect(() => {
    if (!config.enableKeyboardNavigation) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // A sheet or menu that handled Escape already marked it.
      if (e.key === 'Escape' && !e.defaultPrevented && drillDownPath.length > 0) {
        setDrillDownPath((prev) => prev.slice(0, -1));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [drillDownPath, setDrillDownPath, config.enableKeyboardNavigation]);

  return (
    <div className="h-full w-full">
      {config.showBreadcrumb !== false && drillDownPath.length > 0 && (
        <TreemapBreadcrumb
          path={drillDownPath.map((id) => {
            const findNode = (nodes: TreemapDataItem[]): string => {
              for (const node of nodes) {
                if (node.id === id) return node.name;
                if (node.children) {
                  const name = findNode(node.children);
                  if (name) return name;
                }
              }
              return '';
            };
            return findNode(data);
          })}
          onNavigate={handleBreadcrumbNavigate}
          rootLabel={config.rootLabel}
        />
      )}

      <TooltipProvider>
        <div
          ref={containerRef}
          className="bg-background relative overflow-hidden"
          style={{
            width: config.width || '100%',
            height: config.height || '600px',
          }}
          role="group"
          aria-label={config.ariaLabel ?? 'Treemap visualization'}
        >
          {layoutNodes.map((node, index) => (
            <React.Fragment key={node.id}>
              {config.showTooltip !== false ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <TreemapCell
                      node={node}
                      index={index}
                      config={config}
                      onCellClick={config.onCellClick}
                      onDrillDown={handleDrillDown}
                    />
                  </TooltipTrigger>
                  <TooltipContent>
                    {config.renderTooltip ? (
                      config.renderTooltip(node)
                    ) : (
                      <div className="text-sm">
                        <div className="font-medium">{node.name}</div>
                        <div className="text-slate-500">
                          Value: {node.value.toLocaleString()}
                        </div>
                        {node.metadata &&
                          Object.entries(node.metadata).map(([key, value]) => (
                            <div key={key} className="text-xs text-slate-400">
                              {key}: {String(value)}
                            </div>
                          ))}
                      </div>
                    )}
                  </TooltipContent>
                </Tooltip>
              ) : (
                <TreemapCell
                  node={node}
                  index={index}
                  config={config}
                  onCellClick={config.onCellClick}
                  onDrillDown={handleDrillDown}
                />
              )}
            </React.Fragment>
          ))}
        </div>
      </TooltipProvider>
    </div>
  );
};

// Example Usage Component
const TreemapExample: React.FC = () => {
  // Sample financial data
  const sampleData: TreemapDataItem[] = [
    {
      id: 'tech',
      name: 'Technology',
      value: 0,
      children: [
        { id: 'aapl', name: 'AAPL', value: 3200, metadata: { change: 2.5 } },
        { id: 'msft', name: 'MSFT', value: 2800, metadata: { change: -1.2 } },
        { id: 'googl', name: 'GOOGL', value: 2100, metadata: { change: 0.8 } },
        { id: 'meta', name: 'META', value: 1400, metadata: { change: 3.1 } },
      ],
    },
    {
      id: 'finance',
      name: 'Finance',
      value: 0,
      children: [
        { id: 'jpm', name: 'JPM', value: 1800, metadata: { change: -0.5 } },
        { id: 'bac', name: 'BAC', value: 1200, metadata: { change: 1.2 } },
        { id: 'wfc', name: 'WFC', value: 900, metadata: { change: -2.3 } },
      ],
    },
    {
      id: 'healthcare',
      name: 'Healthcare',
      value: 0,
      children: [
        { id: 'unh', name: 'UNH', value: 1600, metadata: { change: 0.3 } },
        { id: 'jnj', name: 'JNJ', value: 1400, metadata: { change: -0.8 } },
        { id: 'pfe', name: 'PFE', value: 1100, metadata: { change: 1.5 } },
      ],
    },
  ];

  // Calculate parent values
  sampleData.forEach((parent) => {
    if (parent.children) {
      parent.value = parent.children.reduce(
        (sum, child) => sum + child.value,
        0
      );
    }
  });

  const treemapConfig: TreemapConfig = {
    height: 600,
    colorScheme: 'financial',
    animationEnabled: true,
    animationDuration: 300,
    minCellSize: 40,
    showTooltip: true,
    showBreadcrumb: true,
    enableDrillDown: true,
    enableKeyboardNavigation: true,
    borderRadius: 8,
    padding: 4,
    renderCell: (node) => (
      <div className="text-center">
        <div className="truncate text-sm font-semibold">{node.name}</div>
        <div className="mt-1 text-xs">${node.value.toLocaleString()}</div>
        {node.metadata?.change && (
          <div
            className={cn(
              'mt-1 text-xs font-medium',
              node.metadata.change > 0 ? 'text-green-600' : 'text-red-600'
            )}
          >
            {node.metadata.change > 0 ? '+' : ''}
            {node.metadata.change}%
          </div>
        )}
      </div>
    ),
    onCellClick: (node) => {
      console.log('Cell clicked:', node);
    },
  };

  return (
    <div className="min-h-screen bg-slate-50 p-8 dark:bg-slate-900">
      <div className="mx-auto max-w-7xl">
        <h1 className="mb-2 text-3xl font-bold">Market Overview</h1>
        <p className="mb-8 text-slate-600 dark:text-slate-400">
          Click on sectors to drill down • Press ESC to go back • Use keyboard
          navigation
        </p>
        <TreemapContainer data={sampleData} config={treemapConfig} />
      </div>
    </div>
  );
};

export default TreemapExample;

export { TreemapContainer as Treemap, drillDownPathAtom };
export type { TreemapDataItem, TreemapNode, TreemapConfig };
