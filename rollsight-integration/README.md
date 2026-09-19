# RollSight for Foundry VTT — development candidate

This source candidate targets Foundry 12–14 using native Dice Fulfillment. It has not been published as a new module release. See the repository's `docs/FOUNDRY_V14_AUDIT.md` for verification evidence and limits.

Enable the module as GM. In Module Settings, choose **Link this world (GM)** once. Each user refreshes their own connection and copies their personal player code into the RollSight desktop play session. Select **RollSight** (or **Manual**, with Manual compatibility enabled) for the relevant dice in Foundry Dice Configuration. Start the roll normally in Foundry, then roll and send dice from the desktop app.

The native dice prompt stays visible. A single pending roll receives dice automatically. When multiple rolls are open, choose **Use this roll** on the intended prompt. **Stop receiving dice** pauses it. Requests pause after five minutes; select the roll again to resume. Turning off **Receive RollSight dice** leaves the receiving session. Foundry's own completion/close controls retain their normal behavior, including digital completion of empty slots.

Cloud is the default transport. The browser extension is an alternative for local desktop sessions; enable **Use the browser extension** to select it. Direct browser-to-localhost polling and direct external Foundry socket connections are retired. Use one receiving tab per player. A cloud code is a secret capability: do not share another player's code.

Start initiative and advantage/disadvantage in Foundry. Unsolicited dice can post as a plain roll using your current chat visibility, but are not automatically assigned to combat or combined based on key timing. Foundry roll requests are not sent to the desktop; the desktop sends results after you initiate the roll in Foundry.

Settings, prompt guidance, errors and replay labels are localized in English, Spanish, French, Portuguese, Chinese, Hindi, Bengali, Arabic, Urdu and Indonesian. Older implementation/walkthrough documents alongside this file describe retired code; this README and the audit describe the active entry point.
