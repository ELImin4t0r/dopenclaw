import SwiftUI

/// One entry in the dopenclaw "Features" dropdown. Picking it puts `prompt` in
/// the composer; `sendsImmediately` entries are sent right away, the others
/// wait for the user to finish the sentence (e.g. "Remind me …").
public struct PersonalFeature: Identifiable, Sendable {
    public let id: String
    public let title: String
    public let systemImage: String
    public let prompt: String
    public let sendsImmediately: Bool
}

public struct PersonalFeatureGroup: Identifiable, Sendable {
    public let id: String
    public let title: String
    public let features: [PersonalFeature]
}

/// To add a feature to the dropdown, add an entry here (and the plugin or skill
/// that handles the prompt on the laptop).
public enum PersonalFeatures {
    public static let groups: [PersonalFeatureGroup] = [
        PersonalFeatureGroup(id: "day", title: "My day", features: [
            PersonalFeature(
                id: "today", title: "Today's plan", systemImage: "sun.max",
                prompt: "What's on my schedule and to-do list today?", sendsImmediately: true),
            PersonalFeature(
                id: "reminder", title: "Add a reminder", systemImage: "bell",
                prompt: "Remind me ", sendsImmediately: false),
            PersonalFeature(
                id: "todo", title: "Add a to-do", systemImage: "checklist",
                prompt: "Add to my to-do list: ", sendsImmediately: false),
        ]),
        PersonalFeatureGroup(id: "library", title: "KU Leuven library", features: [
            PersonalFeature(
                id: "reservations", title: "My reservations", systemImage: "books.vertical",
                prompt: "Show my KURT library reservations.", sendsImmediately: true),
            PersonalFeature(
                id: "checkin", title: "Check me in", systemImage: "location",
                prompt: "Check me in at the library.", sendsImmediately: true),
        ]),
        PersonalFeatureGroup(id: "clips", title: "Clipping", features: [
            PersonalFeature(
                id: "clips-find", title: "Find new clips", systemImage: "scissors",
                prompt: "Find and cut new clips for my streamers.", sendsImmediately: true),
            PersonalFeature(
                id: "clips-review", title: "Review clips", systemImage: "checkmark.rectangle.stack",
                prompt: "Show the clips waiting for my approval.", sendsImmediately: true),
            PersonalFeature(
                id: "clips-status", title: "Posting status", systemImage: "chart.bar",
                prompt: "How are my clip channels doing? Show what was posted and what's scheduled.",
                sendsImmediately: true),
        ]),
        PersonalFeatureGroup(id: "aws", title: "AWS", features: [
            PersonalFeature(
                id: "aws-credits", title: "Earn AWS credits", systemImage: "cloud",
                prompt: "Help me with the next step to earn AWS free-tier credits.", sendsImmediately: true),
        ]),
    ]
}

/// Top-bar dropdown listing every dopenclaw feature.
public struct PersonalFeatureMenu: View {
    private let viewModel: OpenClawChatViewModel

    public init(viewModel: OpenClawChatViewModel) {
        self.viewModel = viewModel
    }

    public var body: some View {
        Menu {
            ForEach(PersonalFeatures.groups) { group in
                Section {
                    ForEach(group.features) { feature in
                        Button {
                            self.pick(feature)
                        } label: {
                            Label {
                                Text(verbatim: feature.title)
                                    .font(OpenClawChatTypography.body)
                            } icon: {
                                Image(systemName: feature.systemImage)
                            }
                        }
                    }
                } header: {
                    Text(verbatim: group.title)
                        .font(OpenClawChatTypography.caption)
                }
            }
        } label: {
            Label {
                Text("Features")
                    .font(OpenClawChatTypography.body)
            } icon: {
                Image(systemName: "square.grid.2x2")
            }
        }
        .accessibilityLabel(Text("Features"))
    }

    private func pick(_ feature: PersonalFeature) {
        self.viewModel.input = feature.prompt
        if feature.sendsImmediately {
            self.viewModel.send()
        }
    }
}
