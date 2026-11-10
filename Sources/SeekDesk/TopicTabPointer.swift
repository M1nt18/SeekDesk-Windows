import AppKit
import SwiftUI

@MainActor
final class TopicTabPointers: ObservableObject {
    let handles = NSHashTable<TopicTabPointer.Handle>.weakObjects()
    weak var canvas: TopicTabDragCanvas.Canvas?

    func target(from source: TopicTabPointer.Handle, at point: NSPoint) -> TopicTabPointer.Handle? {
        handles.allObjects.first { view in
            guard view !== source, view.window === source.window, !view.visibleRect.isEmpty else { return false }
            let frame = view.convert(view.visibleRect, to: nil)
            return point.y >= frame.minY && point.y <= frame.maxY && point.x >= frame.minX && point.x <= frame.maxX + 24
        }
    }
}

struct TopicTabPointer: NSViewRepresentable {
    let id: String
    let title: String
    let group: TopicTabPointers
    let select: () -> Void
    let move: (String) -> Void

    func makeNSView(context: Context) -> Handle { Handle() }

    func updateNSView(_ view: Handle, context: Context) {
        view.id = id
        view.title = title
        view.group = group
        view.select = select
        view.move = move
        group.handles.add(view)
    }

    final class Handle: NSView {
        var id = ""
        var title = ""
        weak var group: TopicTabPointers?
        var select: (() -> Void)?
        var move: ((String) -> Void)?
        private var start: NSPoint?

        override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

        override func hitTest(_ point: NSPoint) -> NSView? {
            if NSApp.currentEvent?.type == .rightMouseDown { return nil }
            return super.hitTest(point)
        }

        override func mouseDown(with event: NSEvent) { start = event.locationInWindow }

        override func mouseDragged(with event: NSEvent) {
            guard let start else { return }
            let point = event.locationInWindow
            let delta = point.x - start.x
            guard abs(delta) >= 6 || group?.canvas?.isShowing == true else { return }
            group?.canvas?.update(source: self, delta: delta, target: group?.target(from: self, at: point))
        }

        override func mouseUp(with event: NSEvent) {
            guard let start else { return }
            let point = event.locationInWindow
            let dragged = group?.canvas?.isShowing == true || abs(point.x - start.x) >= 6
            self.start = nil
            group?.canvas?.clear()
            if dragged {
                if let target = group?.target(from: self, at: point) { move?(target.id) }
            } else if bounds.contains(convert(point, from: nil)) {
                select?()
            }
        }

        override func viewWillMove(toWindow window: NSWindow?) {
            if window == nil {
                if start != nil { group?.canvas?.clear() }
                start = nil
            }
            super.viewWillMove(toWindow: window)
        }
    }
}

struct TopicTabDragCanvas: NSViewRepresentable {
    let group: TopicTabPointers

    func makeNSView(context: Context) -> Canvas { Canvas() }
    func updateNSView(_ view: Canvas, context: Context) { group.canvas = view }

    final class Canvas: NSView {
        private var ghost: DragLabel?
        private let insertionLine = NSView()
        var isShowing: Bool { ghost != nil }

        override func hitTest(_ point: NSPoint) -> NSView? { nil }

        func update(source: TopicTabPointer.Handle, delta: CGFloat, target: TopicTabPointer.Handle?) {
            let sourceFrame = source.convert(source.bounds, to: self)
            if ghost == nil {
                let frame = NSRect(origin: .zero, size: sourceFrame.size)
                let label = DragLabel(title: source.title, frame: frame)
                addSubview(label)
                ghost = label
                insertionLine.wantsLayer = true
                insertionLine.layer?.backgroundColor = NSColor.controlAccentColor.cgColor
                insertionLine.layer?.cornerRadius = 1.5
                addSubview(insertionLine)
            }
            let x = min(max(8, sourceFrame.minX + delta), max(8, bounds.width - sourceFrame.width - 8))
            ghost?.setFrameOrigin(NSPoint(x: x, y: sourceFrame.minY - sourceFrame.height - 9))
            insertionLine.isHidden = target == nil
            if let target {
                let frame = target.convert(target.bounds, to: self)
                let insertionX = sourceFrame.minX < frame.minX ? frame.maxX + 28 : frame.minX - 4
                insertionLine.frame = NSRect(x: insertionX - 1.5, y: frame.minY + 1, width: 3, height: frame.height - 2)
            }
        }

        func clear() {
            ghost?.removeFromSuperview()
            ghost = nil
            insertionLine.removeFromSuperview()
        }
    }
}

private final class DragLabel: NSView {
    init(title: String, frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layer?.backgroundColor = NSColor.controlBackgroundColor.cgColor
        layer?.borderColor = NSColor.controlAccentColor.cgColor
        layer?.borderWidth = 1
        layer?.cornerRadius = 6
        layer?.shadowOpacity = 0.20
        layer?.shadowRadius = 6
        layer?.shadowOffset = CGSize(width: 0, height: -2)
        let label = NSTextField(labelWithString: title)
        label.font = .systemFont(ofSize: 12, weight: .medium)
        label.lineBreakMode = .byTruncatingTail
        label.frame = NSRect(x: 9, y: (bounds.height - 16) / 2, width: max(1, bounds.width - 18), height: 16)
        addSubview(label)
    }

    required init?(coder: NSCoder) { nil }

    override func hitTest(_ point: NSPoint) -> NSView? { nil }
}
