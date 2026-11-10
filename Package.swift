// swift-tools-version: 5.10
import Foundation
import PackageDescription

let sparkle: Target
if let local = ProcessInfo.processInfo.environment["SEEKDESK_SPARKLE_XCFRAMEWORK"] {
    sparkle = .binaryTarget(name: "Sparkle", path: local)
} else {
    sparkle = .binaryTarget(
        name: "Sparkle",
        url: "https://github.com/sparkle-project/Sparkle/releases/download/2.10.1/Sparkle-for-Swift-Package-Manager.zip",
        checksum: "4c2e48a3e50ebcc2c88a58a4c7264a1a99c3c31857ce754357afb9cdb323022a"
    )
}

let package = Package(
    name: "SeekDesk",
    platforms: [.macOS(.v14)],
    targets: [
        sparkle,
        .executableTarget(
            name: "SeekDesk",
            dependencies: ["Sparkle"],
            linkerSettings: [.unsafeFlags(["-Xlinker", "-rpath", "-Xlinker", "@executable_path/../Frameworks"])]
        )
    ]
)
