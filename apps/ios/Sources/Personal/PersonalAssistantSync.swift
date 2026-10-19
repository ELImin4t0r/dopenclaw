import CoreLocation
import Foundation
import OpenClawKit
import UserNotifications

/// Pulls personal-assistant data from the laptop Gateway and acts on it locally.
///
/// - `briefing.notifications` (daily-briefing plugin): replaced as local
///   notifications on this phone, so alerts fire without any push relay even
///   when the laptop is asleep.
/// - `library.places` (kuleuven-library plugin): monitored as geofences. On
///   entry iOS wakes the app, we take one fresh fix and hand it to `onArrive`.
///
/// Created at launch so region-entry wakes find their delegate.
@MainActor
final class PersonalAssistantSync: NSObject {
    private static let notificationPrefix = "personal."
    private static let regionPrefix = "personal.place."

    private struct ScheduledNotification: Decodable {
        let id: String
        let atMs: Double
        let title: String
        let body: String
    }

    private struct Place: Decodable {
        let name: String
        let lat: Double
        let lon: Double
        let radiusM: Double
    }

    private let manager = CLLocationManager()
    private var awaitingArrivalFix = false
    var onArrive: ((CLLocation) async -> Void)?

    override init() {
        super.init()
        self.manager.delegate = self
        self.manager.desiredAccuracy = kCLLocationAccuracyBest
    }

    /// Best effort: a Gateway without these plugins simply leaves things as they are.
    func sync(using gateway: GatewayNodeSession) async {
        if let data = try? await gateway.request(method: "briefing.notifications", paramsJSON: "{}", timeoutSeconds: 30),
           let decoded = try? JSONDecoder().decode([String: [ScheduledNotification]].self, from: data),
           let items = decoded["notifications"]
        {
            await self.replaceNotifications(items)
        }
        if let data = try? await gateway.request(method: "library.places", paramsJSON: "{}", timeoutSeconds: 15),
           let decoded = try? JSONDecoder().decode([String: [Place]].self, from: data),
           let places = decoded["places"]
        {
            self.monitor(places)
        }
    }

    private func replaceNotifications(_ items: [ScheduledNotification]) async {
        let center = UNUserNotificationCenter.current()
        let pending = await center.pendingNotificationRequests()
        center.removePendingNotificationRequests(
            withIdentifiers: pending.map(\.identifier).filter { $0.hasPrefix(Self.notificationPrefix) })
        let now = Date()
        for item in items {
            let at = Date(timeIntervalSince1970: item.atMs / 1000)
            let delay = at.timeIntervalSince(now)
            guard delay > 0 else { continue }
            let content = UNMutableNotificationContent()
            content.title = item.title
            content.body = item.body
            content.sound = .default
            content.interruptionLevel = .timeSensitive
            let request = UNNotificationRequest(
                identifier: Self.notificationPrefix + item.id,
                content: content,
                trigger: UNTimeIntervalNotificationTrigger(timeInterval: delay, repeats: false))
            try? await center.add(request)
        }
    }

    private func monitor(_ places: [Place]) {
        let wanted = Dictionary(uniqueKeysWithValues: places.map { (Self.regionPrefix + $0.name, $0) })
        for region in self.manager.monitoredRegions
            where region.identifier.hasPrefix(Self.regionPrefix) && wanted[region.identifier] == nil
        {
            self.manager.stopMonitoring(for: region)
        }
        for (identifier, place) in wanted {
            let region = CLCircularRegion(
                center: CLLocationCoordinate2D(latitude: place.lat, longitude: place.lon),
                // iOS geofences are coarse (~100 m+); the Gateway re-checks the exact radius.
                radius: min(max(place.radiusM, 100), self.manager.maximumRegionMonitoringDistance),
                identifier: identifier)
            region.notifyOnEntry = true
            region.notifyOnExit = false
            self.manager.startMonitoring(for: region)
        }
    }

    /// Shows a notification right away (used for check-in results).
    static func notifyNow(title: String, body: String) async {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        let request = UNNotificationRequest(
            identifier: Self.notificationPrefix + "now." + UUID().uuidString,
            content: content,
            trigger: nil)
        try? await UNUserNotificationCenter.current().add(request)
    }
}

extension PersonalAssistantSync: CLLocationManagerDelegate {
    nonisolated func locationManager(_ manager: CLLocationManager, didEnterRegion region: CLRegion) {
        guard region.identifier.hasPrefix(Self.regionPrefix) else { return }
        Task { @MainActor in
            self.awaitingArrivalFix = true
            self.manager.requestLocation()
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last else { return }
        Task { @MainActor in
            guard self.awaitingArrivalFix else { return }
            self.awaitingArrivalFix = false
            await self.onArrive?(location)
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        Task { @MainActor in
            guard self.awaitingArrivalFix else { return }
            self.awaitingArrivalFix = false
            await Self.notifyNow(
                title: "Library check-in",
                body: "Couldn't get your location. Open dopenclaw and ask it to check you in.")
        }
    }
}
