import SwiftUI

struct ReaderBackdrop: View {
    let palette: DeskPalette
    @AppStorage("workspace.mistBackdrop") private var showGradient = true

    var body: some View {
        palette.reader
            .overlay(alignment: .top) {
                if showGradient {
                    LinearGradient(colors: [palette.readerWash, palette.reader],
                                   startPoint: .top, endPoint: .bottom)
                        .frame(height: 260)
                }
            }
            .clipped()
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }
}
