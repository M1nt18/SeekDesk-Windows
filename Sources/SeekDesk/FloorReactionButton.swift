import SwiftUI

struct FloorReactionButton: View {
    let kind: ForumReactionKind
    let floor: Int
    let count: Int
    let selected: Bool
    let pending: Bool
    let disabled: Bool
    let pulse: UUID?
    let palette: DeskPalette
    let action: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var tint: Color {
        switch kind {
        case .upvote: palette.accent
        case .chicken: palette.featured
        case .dislike: palette.unread
        }
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                ZStack {
                    Group { if reduceMotion { icon } else { animatedIcon } }
                        .opacity(pending ? 0 : 1)
                    if pending { ProgressView().controlSize(.mini).scaleEffect(0.7) }
                }
                .frame(width: 14, height: 15)
                .accessibilityHidden(true)
                Text(count.formatted())
                    .font(.system(size: 11, weight: .medium).monospacedDigit())
                    .contentTransition(reduceMotion ? .identity : .numericText())
                    .animation(reduceMotion ? nil : DeskMotion.selection, value: count)
            }
            .padding(.horizontal, 6).frame(minWidth: 35, minHeight: 26)
            .foregroundStyle(selected ? tint : .secondary)
            .background(selected ? tint.opacity(palette.dark ? 0.17 : 0.10) : .clear, in: RoundedRectangle(cornerRadius: 6))
        }
        .buttonStyle(DeskButtonStyle(compresses: true))
        .disabled(disabled || pending)
        .accessibilityLabel("\(kind.title)第 \(floor) 楼")
        .accessibilityValue(pending ? "正在处理" : "\(count)\(selected ? "，已操作" : "")")
        .accessibilityAddTraits(selected ? .isSelected : [])
        .help(selected ? "已\(kind.title)" : kind.title)
    }

    @ViewBuilder private var icon: some View {
        switch kind {
        case .upvote: Image(systemName: selected ? "hand.thumbsup.fill" : "hand.thumbsup").font(.system(size: 12))
        case .chicken: DeskIcon("fork.knife", asset: "asset-chicken-leg", size: 13)
        case .dislike: Image(systemName: selected ? "hand.thumbsdown.fill" : "hand.thumbsdown").font(.system(size: 12))
        }
    }

    private var animatedIcon: some View {
        let color = tint
        return icon.keyframeAnimator(initialValue: Motion(), trigger: pulse) { icon, value in
            icon.scaleEffect(value.scale).rotationEffect(.degrees(value.tilt)).offset(y: value.lift)
                .overlay(alignment: .top) {
                    Text("+1").font(.system(size: 10, weight: .semibold).monospacedDigit())
                        .foregroundStyle(color).fixedSize()
                        .opacity(value.spark).offset(y: -8 - (1 - value.spark) * 10)
                        .allowsHitTesting(false).accessibilityHidden(true)
                }
        } keyframes: { _ in
            KeyframeTrack(\.scale) {
                CubicKeyframe(1.28, duration: 0.15)
                CubicKeyframe(0.96, duration: 0.15)
                CubicKeyframe(1, duration: 0.15)
            }
            KeyframeTrack(\.lift) {
                CubicKeyframe(kind == .dislike ? 3 : -4, duration: 0.15)
                CubicKeyframe(0, duration: 0.28)
            }
            KeyframeTrack(\.tilt) {
                CubicKeyframe(kind == .chicken ? -19 : 0, duration: 0.15)
                CubicKeyframe(kind == .chicken ? 5 : 0, duration: 0.15)
                CubicKeyframe(0, duration: 0.15)
            }
            KeyframeTrack(\.spark) {
                LinearKeyframe(1, duration: 0.12)
                LinearKeyframe(1, duration: 0.13)
                CubicKeyframe(0, duration: 0.26)
            }
        }
    }

    private struct Motion {
        var scale = 1.0
        var lift = 0.0
        var tilt = 0.0
        var spark = 0.0
    }
}
