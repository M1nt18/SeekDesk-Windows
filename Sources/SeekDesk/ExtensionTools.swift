import AppKit
import SwiftUI

struct OfficeCoverView: View {
    let palette: DeskPalette
    @EnvironmentObject private var extensions: DeskExtensions

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 11) {
                DeskIcon("tablecells.fill").foregroundStyle(.green)
                Text(extensions.officeTitle.isEmpty ? "工作计划" : extensions.officeTitle).font(.headline)
                Spacer()
                Button("恢复窗口") { extensions.officePresented = false }
                    .keyboardShortcut(extensions.shortcut, modifiers: [.command, .shift])
            }
            .padding(.leading, 83).padding(.trailing, 18).frame(height: 53)
            Divider()
            ScrollView([.horizontal, .vertical]) {
                Grid(alignment: .leading, horizontalSpacing: 1, verticalSpacing: 1) {
                    GridRow {
                        cell("", header: true, width: 38)
                        ForEach(["A", "B", "C", "D", "E", "F"], id: \.self) { cell($0, header: true) }
                    }
                    ForEach(1...24, id: \.self) { row in
                        GridRow {
                            cell(String(row), header: true, width: 38)
                            ForEach(0..<6) { col in
                                cell(row == 1 ? ["事项", "负责人", "开始日期", "截止日期", "状态", "备注"][col] : "")
                            }
                        }
                    }
                }
                .background(palette.line)
            }
        }
        .background(palette.reader)
        .accessibilityLabel("办公视图")
    }

    private func cell(_ text: String, header: Bool = false, width: CGFloat = 132) -> some View {
        Text(text).font(.system(size: 12, weight: header ? .semibold : .regular))
            .frame(width: width, height: 27)
            .background(header ? palette.surface : palette.reader)
    }
}
