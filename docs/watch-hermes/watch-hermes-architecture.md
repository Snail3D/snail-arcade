# Apple Watch → Hermes AI Agent Trigger Architecture
## Design Document (2026-05-04)

### Problem Statement
Users want to trigger their Hermes AI agent from an Apple Watch with minimal effort.
No dedicated apps exist on the market yet.

---

### Architecture Overview

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐     ┌─────────────┐
│ Apple Watch │────▶│  Shortcuts /  │────▶│  API Gateway  │────▶│  Hermes     │
│ (UI/Input)  │     │  Watch App   │     │  (Webhook)   │     │  Agent      │
└─────────────┘     └──────────────┘     └──────────────┘     └─────────────┘
```

### Option A: Shortcuts-Only (Fastest to Deploy)

**Best for:** Quick prototype, no App Store needed
**Time to MVP:** 1-2 hours

#### Flow:
1. User activates Siri or opens Shortcuts app on Watch
2. Triggers a custom shortcut: "Trigger Hermes"
3. Shortcut sends POST to your API endpoint (Discord webhook / custom server)
4. Hermes agent processes the request and responds

#### Implementation:
```swift
// In WatchKit Extension (AppDelegate.swift or ViewModel)
import Foundation

class HermesTrigger {
    func triggerAgent(message: String) async throws {
        let url = URL(string: "https://your-api-endpoint.com/hermes/trigger")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let body = ["agent": "hermes", "message": message, "source": "apple-watch"]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        
        let (_, response) = try await URLSession.shared.dataTask(with: request).value
        guard (response as? HTTPURLResponse)?.statusCode == 200 else {
            throw NSError(domain: "HermesError", code: 400, userInfo: nil)
        }
    }
}
```

#### Apple Shortcuts API:
- WatchOS supports Siri shortcuts natively
- No App Store submission needed
- Can be activated via:
  - "Hey Siri, trigger Hermes" (voice command)
  - Custom shortcut tile on watch face complication
  - Double tap of side button (customizable)

---

### Option B: Full Watch App (Best UX)

**Best for:** Polished, app-store-quality experience
**Time to MVP:** 1-2 weeks

#### Tech Stack:
| Layer | Technology | Notes |
|-------|-----------|-------|
| Watch UI | SwiftUI + WKInterfaceController | Native, smooth, always-on display support |
| API Client | URLSession (async/await) | Modern Swift concurrency |
| Backend | Firebase Cloud Functions / Vercel / Railway | Serverless, cheap to host |
| Auth | JWT tokens in Keychain | Secure credential storage |

#### App Structure:
```
HermesWatch/
├── HermesWatch.app (target)
│   └── HermesWatchExtension.watchkitapp
│       ├── Main.swift (entry point)
│       ├── Views/
│       │   ├── ContentView.swift (main screen)
│       │   ├── TriggerView.swift (quick trigger UI)
│       │   └── HistoryView.swift (past interactions)
│       ├── ViewModels/
│       │   └── HermesAPI.swift (API client)
│       └── Complications/
│           └── TimelineProvider.swift (watch face complication)
├── HermesServer/ (backend API)
│   ├── api.py (FastAPI or Express endpoint)
│   ├── webhooks/
│   │   └── discord.js / telegram.py (platform integrations)
│   └── auth/
│       └── tokens.json (JWT management)
```

#### Key Features:
1. **Quick Trigger Screen** — One tap to send a pre-built command
2. **Voice Input** — Dictation via Watch's built-in speech recognition (dictation)
3. **Watch Face Complication** — Long press complication to trigger Hermes instantly
4. **Haptic Feedback** — Haptic patterns for different response types (success, error, processing)
5. **Dark Mode** — Native dark theme for Always-On Display

---

### Option C: Hybrid (Best of Both Worlds)

**Combine Shortcuts + App Store app:**
1. Users install the Hermes Watch app from the App Store for full features
2. Shortcut-based trigger for Siri voice commands (works on all watch models)
3. Watch face complication for one-tap access

---

### Backend Architecture

```
┌─────────────────────────────┐
│  Hermes API Gateway          │
│  (FastAPI/Express)           │
├─────────────────────────────┤
│  /trigger  (POST)           │  ← Apple Watch → Discord/Telegram/WhatsApp
│  /status   (GET)            │  ← App polling for response status
│  /history  (GET)            │  ← Past interactions
│  /webhooks/                  │  ← Incoming from Hermes agents
└─────────────────────────────┘
```

#### Example API Call:
```json
POST /trigger
{
  "agent": "hermes",
  "message": "What's on my calendar?",
  "source": "apple-watch",
  "userId": "eric-woodard"
}
```

Response:
```json
{
  "status": "processing",
  "messageId": "hermes-12345",
  "estimatedWait": "3s"
}

// Then poll:
GET /status/hermes-12345
{
  "status": "completed",
  "response": "Your next meeting is Wednesday..."
}
```

---

### Watch Face Complication Design

**Type:** Extra Large (44mm+), Medium, Small — all sizes
**Content:** 
- Icon: SnailKing logo (hermes-agent icon)
- Text: "Tap or Hold"
- When tapped: Triggers Hermes directly (no app opening needed)

```swift
// ComplicationTimelineProvider.swift
func getCurrentTimelineEntry(for complication: WKComplication, with completion: (@escaping (TKCurrentTimelineEntry?) -> Void)) {
    let template = WKComplicationTemplate.icnIconTextLargeTitle(
        image: HKImage(named: "snailKing")!,
        text: "Tap Here"
    )
    completion(TKTimelineEntry(date: Date(), complicationTemplate: template))
}

func getSampleProviderConfigurations(for complication: WKComplication) async -> [TKComplication] {
    return await TKComplication.complications()
}
```

---

### Siri Integration (Shortcuts)

```
Siri Command: "Hey Siri, trigger Hermes"
Action: Open Hermes Watch App → Send message "What's happening?"
Shortcut Details:
  - Name: "Hermes Quick Trigger"
  - Icon: SnailKing (custom app icon)
  - Trigger Type: "Send Hermes Message" (text input from user)
```

---

### Security Considerations

1. **Authentication:** JWT tokens stored in Apple Keychain
2. **Data Encryption:** All API calls over HTTPS (TLS 1.3)
3. **Session Management:** Refresh tokens expire after 24 hours
4. **WatchOS Keychain Access:** Use `SecItemAdd`/`SecItemCopyMatching` for credential storage
5. **No PII on server:** Messages can be ephemeral (auto-delete after response)

---

### Development Path (Recommended)

#### Phase 1: Shortcuts Prototype (Day 1-2)
- [ ] Create Apple Shortcut using the Shortcuts app on Watch
- [ ] Endpoint: Simple Express/FastAPI server on Vercel or Railway
- [ ] Test: "Hey Siri, trigger Hermes" → sends message to agent

#### Phase 2: Watch App MVP (Week 1-2)
- [ ] SwiftUI watchOS app with WKInterfaceController
- [ ] Quick trigger screen + voice input (Speech Recognition framework)
- [ ] Basic haptic feedback patterns

#### Phase 3: Full Product (Month 1-2)
- [ ] Watch Face complications (all sizes)
- [ ] Full complication system with haptic feedback for success, error, processing states
- [ ] Apple Watch complications (always-on display support)
- [ ] App Store submission

---

### Minimum Viable Spec

**Watch App:** 3 screens (1)
- **Main Screen (trigger screen):** Simple text input field + "Send" button. Uses `SwiftUI`'s TextField or Speech Recognition API
- **Response Screen:** Shows Hermes' response (with haptic feedback on completion)
- **Complication:** Always-on display with snail logo + "Tap" text

**Backend:**
- One REST endpoint: `POST /api/hermes/trigger` (accepts `{agent, message}`)
- Optional: `GET /api/hermes/status/{id}` (for async responses on slow networks)

**Platform:**
- Deploy to: Vercel, Railway, or Fly.io (free tier available)
- Hermes agent receives webhook → processes → responds

---

### Estimated Costs (Monthly)
| Item | Cost |
|------|------|
| Server (Vercel/Railway free tier) | $0/mo |
| App Store Developer Program | $99 (one-time) |
| Hermes agent server (your current setup) | Existing |
| **Total** | **$0/mo + $99 one-time** |

---

### Files to Create (Next Steps)
1. `HermesWatch/` - Swift/SwiftUI watchOS project (Xcode)
2. `HermesServer/api.py` - FastAPI server endpoint
3. `apple-shortcuts/HermesTrigger.shortcut` - Exported Shortcuts file for Watch
4. `complication-design.sketch` or `.fig` - Figma design for watch face complication (SnailKing logo)
