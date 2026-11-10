import AppKit
import SwiftUI

struct DeskResizeHandle: NSViewRepresentable {
    var vertical = false
    var change: (CGFloat) -> Void
    var finish: (CGFloat) -> Void
    var reset: () -> Void

    func makeNSView(context: Context) -> Handle { Handle() }

    func updateNSView(_ view: Handle, context: Context) {
        if view.vertical != vertical {
            view.vertical = vertical
            view.window?.invalidateCursorRects(for: view)
        }
        view.change = change
        view.finish = finish
        view.reset = reset
    }

    final class Handle: NSView {
        var change: ((CGFloat) -> Void)?
        var finish: ((CGFloat) -> Void)?
        var reset: (() -> Void)?
        var vertical = false
        private var start: CGFloat?
        private func position(_ event: NSEvent) -> CGFloat {
            vertical ? event.locationInWindow.y : event.locationInWindow.x
        }

        override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

        override func resetCursorRects() {
            addCursorRect(bounds, cursor: vertical ? .resizeUpDown : .resizeLeftRight)
        }

        override func mouseDown(with event: NSEvent) {
            if event.clickCount == 2 {
                start = nil
                reset?()
            } else {
                start = position(event)
            }
        }

        override func mouseDragged(with event: NSEvent) {
            if let start { change?(position(event) - start) }
        }

        override func mouseUp(with event: NSEvent) {
            guard let start else { return }
            self.start = nil
            finish?(position(event) - start)
        }
    }
}

enum DeskSidebarSizing {
    static let standard = 228.0
    static let divider: CGFloat = 9
    static let range: ClosedRange<CGFloat> = 184...360

    static func bounds(window: CGFloat) -> ClosedRange<CGFloat> {
        range.lowerBound...max(range.lowerBound, min(range.upperBound, window - (240 + 412 + 2 * divider)))
    }
}
