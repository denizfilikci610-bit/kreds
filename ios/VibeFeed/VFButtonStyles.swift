import SwiftUI

// Tryk-animationer til knapper i hele den native app.
//
// Hver stil bruger SAMME animation ved tryk-ned og slip (`value: configuration.isPressed`),
// så knappen "kommer ind og ud" ens — præcis som ejeren bad om. Variationen opnås ved at
// vælge forskellige stilarter til forskellige slags knapper (ikoner, primære handlinger,
// tekst, piller, store rækker, legende reaktioner), så ikke alt animerer ens.
//
// Stilarterne tegner kun `configuration.label` (som .plain), så de kan erstatte .plain
// UDEN at ændre en knaps udseende — de tilføjer kun tryk-feedbacken.

/// Ikon-knapper (luk, blitz, vend kamera, tilbage-pil, fane-ikoner): hurtigt, kontant skub ind.
struct VFPressScale: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.90 : 1)
            .animation(.spring(response: 0.28, dampingFraction: 0.55), value: configuration.isPressed)
    }
}

/// Primære handlinger (Del, Videre, Godkend, Følg): livligt "pop" med et lille sving ved slip.
struct VFPressPop: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.88 : 1)
            .animation(.spring(response: 0.34, dampingFraction: 0.5), value: configuration.isPressed)
    }
}

/// Tekst/nav-knapper (Annuller, Se mere, rene tekst-handlinger): diskret dæmpning + lille skub.
struct VFPressFade: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.96 : 1)
            .opacity(configuration.isPressed ? 0.55 : 1)
            .animation(.easeOut(duration: 0.16), value: configuration.isPressed)
    }
}

/// Piller/chips (kreds-chips, format-piller, mention-kandidater, format-vælger): blødt skub.
struct VFPressChip: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.93 : 1)
            .animation(.spring(response: 0.30, dampingFraction: 0.62), value: configuration.isPressed)
    }
}

/// Store flader/rækker (kommentar-rækker, liste-elementer, medlems-rækker): meget diskret
/// skub + dæmpning, så en stor flade ikke "hopper" for meget.
struct VFPressCard: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.985 : 1)
            .opacity(configuration.isPressed ? 0.7 : 1)
            .animation(.easeOut(duration: 0.18), value: configuration.isPressed)
    }
}

/// Legende knapper (hjerte/like, emoji-reaktioner): fjedrende bounce med tydeligt sving.
struct VFPressBounce: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.80 : 1)
            .animation(.spring(response: 0.32, dampingFraction: 0.42), value: configuration.isPressed)
    }
}

// Bekvemme kaldenavne: .buttonStyle(.vfPressScale) osv.
extension ButtonStyle where Self == VFPressScale  { static var vfPressScale:  VFPressScale  { .init() } }
extension ButtonStyle where Self == VFPressPop    { static var vfPressPop:    VFPressPop    { .init() } }
extension ButtonStyle where Self == VFPressFade   { static var vfPressFade:   VFPressFade   { .init() } }
extension ButtonStyle where Self == VFPressChip   { static var vfPressChip:   VFPressChip   { .init() } }
extension ButtonStyle where Self == VFPressCard   { static var vfPressCard:   VFPressCard   { .init() } }
extension ButtonStyle where Self == VFPressBounce { static var vfPressBounce: VFPressBounce { .init() } }
