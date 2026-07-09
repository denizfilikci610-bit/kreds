import Foundation

/// Shared @-mention support for the native text fields (memory caption + comment sheet).
/// The web pushes candidate cards in the snapshots (native has no data access of its own);
/// native only filters LOCALLY on the trailing "@token" and inserts "@handle " on tap.
/// The web/DB own all real mention semantics (rendering, notifications, visibility).
struct MentionCard: Identifiable, Equatable {
    let handle: String
    let name: String
    let avatarUrl: String
    let initials: String
    let gradient: [String]
    var id: String { handle }
}

enum MentionSupport {
    static func parseCards(_ raw: Any?) -> [MentionCard] {
        guard let arr = raw as? [[String: Any]] else { return [] }
        return arr.compactMap { d in
            guard let handle = d["handle"] as? String, !handle.isEmpty else { return nil }
            return MentionCard(
                handle: handle,
                name: (d["name"] as? String) ?? handle,
                avatarUrl: (d["avatarUrl"] as? String) ?? "",
                initials: (d["initials"] as? String) ?? "?",
                gradient: (d["gradient"] as? [String]) ?? []
            )
        }
    }

    private static func isHandleChar(_ c: Character) -> Bool {
        c.isASCII && (c.isLetter || c.isNumber || c == "_" || c == ".")
    }

    /// The active "@token" the user is typing at the END of the text (SwiftUI TextFields
    /// don't expose the caret, so end-of-text is the supported case). Returns the query
    /// after "@" ("" right after typing @), or nil when no mention is being typed.
    static func trailingToken(_ text: String) -> String? {
        guard let at = text.lastIndex(of: "@") else { return nil }
        if at > text.startIndex {
            let prev = text[text.index(before: at)]
            if prev == "@" || isHandleChar(prev) { return nil } // ligner en mail/midt i et ord
        }
        let q = String(text[text.index(after: at)...])
        guard q.count <= 20, q.allSatisfy(isHandleChar) else { return nil }
        return q.lowercased()
    }

    /// Candidates matching the active token (prefix on handle or name) — empty when idle.
    static func hits(_ text: String, _ cards: [MentionCard]) -> [MentionCard] {
        guard let q = trailingToken(text) else { return [] }
        let out = cards.filter { q.isEmpty || $0.handle.hasPrefix(q) || $0.name.lowercased().hasPrefix(q) }
        return Array(out.prefix(6))
    }

    /// Replace the trailing "@token" with "@handle ". Ville resultatet overskride 280 tegn,
    /// afbrydes i stedet (som web) — feltets efterfølgende klip må ALDRIG halvere et handle
    /// (en midt-klippet mention ville pege på en forkert/ukendt bruger).
    static func insert(_ text: String, _ handle: String) -> String {
        guard let at = text.lastIndex(of: "@") else { return text }
        let out = String(text[..<at]) + "@" + handle + " "
        return out.count > 280 ? text : out
    }
}
