"use client"

import { useRef, useCallback, useEffect, useState } from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { PanelRightClose, PanelRight } from "lucide-react"

interface ResizablePanelProps {
  children: React.ReactNode
  defaultWidth: number
  minWidth: number
  maxWidth: number
  position: "left" | "right"
  className?: string
  isCollapsed?: boolean
  onToggleCollapse?: () => void
  collapsedWidth?: number
}

export function ResizablePanel({
  children,
  defaultWidth,
  minWidth,
  maxWidth,
  position,
  className,
  isCollapsed = false,
  onToggleCollapse,
  collapsedWidth = 48,
}: ResizablePanelProps) {
  const [width, setWidth] = useState(defaultWidth)
  const [isResizing, setIsResizing] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  // Store width before collapse to restore it
  const previousWidthRef = useRef(defaultWidth)

  // Save width when not collapsed
  useEffect(() => {
    if (!isCollapsed) {
      previousWidthRef.current = width
    }
  }, [width, isCollapsed])

  const startResizing = useCallback((e: React.MouseEvent) => {
    if (isCollapsed) return
    e.preventDefault()
    setIsResizing(true)
  }, [isCollapsed])

  const stopResizing = useCallback(() => {
    setIsResizing(false)
  }, [])

  const resize = useCallback(
    (e: MouseEvent) => {
      if (!isResizing || !panelRef.current) return

      const rect = panelRef.current.getBoundingClientRect()
      let newWidth: number

      if (position === "right") {
        // For right panel, resize by dragging left edge
        newWidth = rect.right - e.clientX
      } else {
        // For left panel, resize by dragging right edge
        newWidth = e.clientX - rect.left
      }

      // Clamp to min/max
      newWidth = Math.max(minWidth, Math.min(maxWidth, newWidth))
      setWidth(newWidth)
    },
    [isResizing, minWidth, maxWidth, position]
  )

  useEffect(() => {
    if (isResizing) {
      window.addEventListener("mousemove", resize)
      window.addEventListener("mouseup", stopResizing)
      // Prevent text selection while resizing
      document.body.style.cursor = "col-resize"
      document.body.style.userSelect = "none"
    }

    return () => {
      window.removeEventListener("mousemove", resize)
      window.removeEventListener("mouseup", stopResizing)
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
    }
  }, [isResizing, resize, stopResizing])

  const currentWidth = isCollapsed ? collapsedWidth : width

  return (
    <div
      ref={panelRef}
      className={cn(
        "relative flex-shrink-0 transition-all duration-200",
        className
      )}
      style={{ width: currentWidth }}
    >
      {/* Collapse Toggle Button */}
      {onToggleCollapse && (
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "absolute top-3 z-20 size-7",
            position === "right"
              ? isCollapsed ? "left-1/2 -translate-x-1/2" : "left-3"
              : isCollapsed ? "left-1/2 -translate-x-1/2" : "right-3"
          )}
          onClick={onToggleCollapse}
        >
          {isCollapsed ? (
            <PanelRight className="size-4 text-muted-foreground" />
          ) : (
            <PanelRightClose className="size-4 text-muted-foreground" />
          )}
        </Button>
      )}

      {/* Resize Handle - only visible when not collapsed */}
      {!isCollapsed && (
        <div
          onMouseDown={startResizing}
          className={cn(
            "absolute top-0 bottom-0 w-1 cursor-col-resize z-10 group",
            position === "right" ? "left-0 -translate-x-1/2" : "right-0 translate-x-1/2"
          )}
        >
          {/* Visual indicator on hover/drag */}
          <div
            className={cn(
              "absolute inset-y-0 w-[3px] transition-colors",
              position === "right" ? "left-0" : "right-0",
              isResizing ? "bg-primary" : "bg-transparent group-hover:bg-primary/50"
            )}
          />
        </div>
      )}

      {/* Content - hidden when collapsed */}
      <div className={cn(
        "h-full transition-opacity duration-200",
        isCollapsed ? "opacity-0 pointer-events-none" : "opacity-100"
      )}>
        {children}
      </div>
    </div>
  )
}
