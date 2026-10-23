# Demo video script (target 2:40, hard limit under 3:00)

Record the simulator at https://d27lym254gcbg5.cloudfront.net in Chrome at 1440x900 with system audio on so the spoken replies are captured. Before recording, reload the page so today starts empty (the demo account is re-seeded nightly; you can also remove today's entries with "remove the banana", etc.). Use your own voice with the microphone button, or the suggestion chips if the room is noisy. No music is needed; if you add some, use only royalty-free tracks you have rights to, and no Amazon or Alexa logos.

| Time | Shot | On screen | Voiceover / speech |
|---|---|---|---|
| 0:00–0:12 | Title card | "Macro Coach: say what you ate, get real numbers back." | "Tracking food works, but nobody wants to type every meal. Macro Coach lets you just say it." |
| 0:12–0:20 | Full simulator | Header, pipeline strip, empty transcript, rings at zero, weekly chart | "This is a simulated Alexa+ experience talking to our self-hosted MCP server on AWS." |
| **Scene 1: log breakfast by voice** | | | |
| 0:20–0:42 | Click mic, speak | Transcript fills in; MCP traffic panel shows `log_meal` with arguments and structured result; card with rings appears | You: "I had two scrambled eggs and a banana for breakfast." Coach answers aloud with calories, protein and what's left. |
| 0:42–0:52 | Zoom on traffic panel | Highlight `structuredContent` items with FDC IDs | "Every number comes from USDA FoodData Central, not the model." |
| 0:52–1:05 | Speak correction | `edit_log_entry` call; rings update | You: "Actually, make that one egg, not two." |
| **Scene 2: ask what's left** | | | |
| 1:05–1:22 | Speak | `get_remaining_budget` call; rings | You: "How much protein do I still need today?" Coach replies with remaining macros and a coaching hint. |
| **Scene 3: dinner from ingredients, then the weekly report** | | | |
| 1:22–1:48 | Speak | `suggest_meal` call; meal idea carousel card | You: "What should I eat for dinner? I have chicken, rice and broccoli." Coach suggests a meal with calories and protein. |
| 1:48–2:10 | Speak | `get_weekly_report` call; weekly bar card and dashboard chart | You: "How did I do this week?" Coach gives averages, adherence, best day and a tip. |
| 2:10–2:15 | Optional | `set_goals` | You: "I'm trying to cut. Set my goal to 2,000 calories and 150 grams of protein." |
| **Architecture (15 seconds)** | | | |
| 2:15–2:30 | Architecture diagram from the README | Voice → Alexa+ / simulator → MCP over Streamable HTTP → Lambda (MCP SDK) → Bedrock, FoodData Central, DynamoDB; CDK | "Alexa+ or our simulator calls a stateless MCP server on Lambda. Amazon Bedrock parses meals and plans turns, FoodData Central supplies the numbers, DynamoDB stores the log, and CDK deploys it all. The server also supports OAuth 2.1 and MCP Apps cards for Alexa+." |
| 2:30–2:40 | End card | GitHub URL, MCP endpoint, "Built during the hackathon window" | "Macro Coach. Open source, and live for judges today." |

## Recording tips

- Do one dry run first so FoodData Central lookups are cached and responses are fast.
- If the browser asks for microphone permission, allow it before you start recording.
- Keep the traffic panel visible; judges want to see the MCP calls.
- Export at 1080p and upload to YouTube as Public or Unlisted (it must be publicly viewable), then paste the link into Devpost.
