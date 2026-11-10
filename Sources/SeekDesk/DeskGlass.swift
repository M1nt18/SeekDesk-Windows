import SwiftUI

extension View {
    func deskGlass<S: Shape>(in shape: S, solid: Color, interactive: Bool = false) -> some View {
        modifier(DeskGlassSurface(shape: shape, solid: solid, interactive: interactive))
    }
}

private struct DeskGlassSurface<S: Shape>: ViewModifier {
    let shape: S
    let solid: Color
    let interactive: Bool
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        if reduceTransparency {
            content.background(solid, in: shape)
                .overlay { shape.strokeBorderFallback.allowsHitTesting(false) }
        } else if #available(macOS 26.0, *) {
            content.glassEffect(.regular.interactive(interactive && !reduceMotion), in: shape)
        } else {
            content.background(.regularMaterial, in: shape)
                .overlay { shape.strokeBorderFallback.allowsHitTesting(false) }
        }
    }
}

private extension Shape {
    var strokeBorderFallback: some View { stroke(.primary.opacity(0.09), lineWidth: 1) }
}
