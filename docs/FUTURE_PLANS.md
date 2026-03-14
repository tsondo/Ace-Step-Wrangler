# Future Plans

Ideas and designs parked for future implementation.

---

## Mobile-Responsive Layout (Bottom Tab Bar)

**Context:** The current UI is a fixed three-column DAW-style grid (`260px | 1fr | 520px`) with no `@media` breakpoints. It works well on desktop but is unusable on phone screens.

**Approach:** At narrow viewports (`max-width: 768px`), collapse to a single-column layout with a bottom tab bar to switch between panels. Desktop layout stays untouched.

### Design

**Bottom tab bar** with three tabs:
- **Song** — shows the left column (lyrics/rework/analyze input)
- **Output** — shows the center column (results, waveforms)
- **Controls** — shows the right column (sliders, advanced panel)

Only one panel is visible at a time. The Generate button becomes a sticky footer above the tab bar so it's always reachable.

### Implementation Outline

1. **CSS (`@media (max-width: 768px)`):**
   - Override `#main` grid to `grid-template-columns: 1fr`
   - Hide two of three columns via `.mobile-hidden` class
   - Add bottom tab bar (fixed position, ~50px)
   - Sticky Generate button above tab bar
   - Increase touch targets to minimum 44px on buttons and slider thumbs
   - Body gets `overflow: auto` instead of `overflow: hidden`

2. **JS (small addition):**
   - Tab bar click handler toggles which column is visible
   - Remembers active tab across mode switches
   - Auto-switch to Output tab when generation completes

3. **Touch improvements:**
   - Upload zones: add `touchstart`/`touchend` for drag-and-drop (or just rely on the Browse button, which already works on mobile)
   - Waveform scrubbing: existing click handlers fire on tap, should work as-is
   - Advanced panel summary: widen touch target

### Scope

This is purely additive — a `@media` block plus ~30 lines of JS. No changes to existing desktop behavior. All existing HTML structure (three columns as direct children of `#main`) supports this without restructuring.

### When to Build

When the app moves to cloud-accessible deployment (e.g. apps.tsondo.com) and phone users become a real audience.
