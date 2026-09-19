# ONU Studio v1.8.0 - Design QA

## Scope

- Flow: detection, customer/operation, WAN, WiFi/TR-069, review, completion.
- Reference set: `output/onu-studio-guided-ui/01-detectar.png` through `06-resultado-entrega.png`.
- Implementation captures: `output/onu-studio-guided-ui/implementation/`.
- Combined comparisons: `output/onu-studio-guided-ui/qa/compare-*.png`.

## Viewports

- Desktop comparison: 1488 x 1060 CSS viewport.
- Mobile validation: 390 x 844 CSS viewport.

## Findings And Resolution

| Priority | Finding | Resolution |
| --- | --- | --- |
| P0 | None | No blocked workflow or unreadable screen found. |
| P1 | WAN compatibility and remote-management controls extended below the first desktop viewport. | Reduced row density while preserving stable input dimensions; WAN and WiFi/TR-069 task controls now remain scannable with the fixed action footer. |
| P1 | The sidebar did not change context between provisioning stages. | Added firmware capabilities, impact, and backup summaries with stage-specific visibility. |
| P1 | Preview states could be overwritten by the discovery polling cycle. | Added a development-only preview guard and stopped polling during visual QA previews. |
| P2 | Mobile health pills were ambiguous when labels were hidden. | Preserved Local and Railway labels while hiding only the administrator and version details. |
| P2 | Generated device illustration initially used CSS shapes. | Replaced it with a generated transparent PNG asset sized for the detection slot. |

## Interaction Checks

- Operation selection switches to restoration and reveals the existing-client picker.
- Secure WiFi password generation updates the password field.
- Step 4 advances to the final review.
- No horizontal overflow at desktop or mobile widths.
- Sticky footer remains visible and does not resize when controls change.

## Automated Checks

- JavaScript syntax check passed.
- Four wizard utility tests passed.
- Thirty-two Python agent tests passed.
- All JavaScript DOM ID references exist in the HTML document.

final result: passed
